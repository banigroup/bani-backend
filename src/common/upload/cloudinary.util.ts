import { v2 as cloudinary } from 'cloudinary';

// src/load/cloudinary.util.ts'ten TASINDI. Icerigi degismedi: klasor zaten
// parametreydi, kimlik bilgileri ortam degiskeninden okunuyordu - Load'a ozgu
// tek bir sabit yoktu, parametrelestirilecek bir sey cikmadi.
//
// Tasima ZORUNLUYDU, tercih degil: scripts/check-boundaries.js'te "load" izole
// bir birim, "market" ise ticaret kumesinde. market'in ../load/... import etmesi
// dogrudan birim siniri ihlalidir ve CI'da kirmizi verirdi. Cekirdek
// (src/common) her birim tarafindan tuketilebilir; dogru yer burasi.

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export function cloudinaryUpload(buffer: Buffer, klasor: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: klasor, resource_type: 'auto' },
      (error, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error('Yükleme başarısız'));
        resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

/**
 * OZEL (KIMLIK DOGRULAMALI) YUKLEME — KYC BELGELERI ICIN.
 *
 * cloudinaryUpload'dan TEK FARKI: type 'authenticated'. Varsayilan 'upload'
 * tipinde donen secure_url KALICI ve HERKESE ACIKTIR - adresi eline gecen
 * herkes vergi levhasini, kimligi, imza sirkulerini indirebilir. KYC
 * belgeleri icin bu kabul edilemez.
 *
 * 'authenticated' tipinde ayni adres imzasiz cagrildiginda Cloudinary 401
 * doner; erisim yalnizca sunucunun urettigi KISA OMURLU imzali baglantiyla
 * mumkundur (bkz. kycImzaliUrl).
 *
 * YENI DEPOLAMA MIMARISI DEGIL: ayni hesap, ayni klasor duzeni, ayni
 * upload_stream cagrisi; degisen tek sey varligin erisim tipi.
 */
export function cloudinaryOzelYukle(buffer: Buffer, klasor: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: klasor, resource_type: 'auto', type: 'authenticated' },
      (error, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error('Yükleme başarısız'));
        resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

/** kycImzaliUrl'in adresten cikardigi parcalar. */
export interface CloudinaryVarlik {
  publicId: string;
  format: string;
  kaynakTipi: string;
}

/**
 * ADRESTEN VARLIK KIMLIGINI COZ.
 *
 * NEDEN ADRESTEN, VERITABANINDAN DEGIL: public_id/format/resource_type icin
 * satici_belgeleri'ne uc yeni kolon eklemek bir SEMA DEGISIKLIGI olurdu.
 * Adres zaten bu uc bilgiyi tasiyor ve adresi URETEN de biziz
 * (cloudinaryOzelYukle) - bicim disaridan gelen bir girdi degil.
 *
 * BICIM: https://res.cloudinary.com/<cloud>/<kaynakTipi>/authenticated/v<surum>/<klasor>/<ad>.<uzanti>
 * Donusum tarafi (transformation) segmentleri BILEREK desteklenmiyor: bu
 * adresleri yalnizca yukleme cagrisi uretiyor ve donusumsuz donuyorlar.
 *
 * COZULEMEYEN ADRES icin null doner - cagiran o zaman adresi OLDUGU GIBI
 * birakir (geriye donuk uyum: 'authenticated' oncesi yuklenmis /upload/
 * adresleri boylece calismaya devam eder).
 */
export function cloudinaryVarligiCoz(url: string): CloudinaryVarlik | null {
  const eslesme = /\/([a-z]+)\/authenticated\/(?:v\d+\/)?(.+)$/.exec(url ?? '');
  if (!eslesme) return null;
  const kaynakTipi = eslesme[1];
  const yol = eslesme[2];
  const nokta = yol.lastIndexOf('.');
  // Uzantisiz varlik imzalanamaz (private_download_url format ISTER).
  if (nokta <= 0 || nokta === yol.length - 1) return null;
  return { publicId: yol.slice(0, nokta), format: yol.slice(nokta + 1), kaynakTipi };
}

/** Imzali erisim baglantisinin omru. Inceleme icin genis, sizinti icin dar. */
export const KYC_URL_OMRU_SANIYE = 10 * 60;

/**
 * KISA OMURLU IMZALI ERISIM BAGLANTISI.
 *
 * Yetkilendirme BU FONKSIYONUN ISI DEGIL: baglantiyi ancak zaten yetkili
 * olan uclar (saticinin kendi belgeleri / platform yoneticisi inceleme
 * uclari) istiyor. Burada yapilan is, o uclarin dondurdugu adresin SURESIZ
 * ve herkese acik olmamasini saglamak.
 *
 * COZULEMEYEN ADRES OLDUGU GIBI DONER: eski (public) kayitlar ve testlerdeki
 * sahte adresler kirilmaz. Imzalama sirasinda hata cikarsa da adres oldugu
 * gibi doner - belge listesi bir imza hatasi yuzunden 500 olmamali.
 */
export function kycImzaliUrl(url: string, omurSaniye: number = KYC_URL_OMRU_SANIYE): string {
  const varlik = cloudinaryVarligiCoz(url);
  if (!varlik) return url;
  try {
    return cloudinary.utils.private_download_url(varlik.publicId, varlik.format, {
      resource_type: varlik.kaynakTipi,
      type: 'authenticated',
      expires_at: Math.floor(Date.now() / 1000) + omurSaniye,
    });
  } catch {
    return url;
  }
}
/**
 * IMZALI DOGRUDAN YUKLEME — istemci dosyayi Cloudinary'ye KENDISI gonderir.
 *
 * cloudinaryUpload'dan FARKI: orada dosya once sunucuya (RAM'e) gelir, sunucu
 * Cloudinary'ye akitir. Burada sunucu yalnizca IMZA uretir; dosya hic sunucudan
 * gecmez. Buyuk gorsellerde sunucunun RAM'ini ve bant genisligini mesgul
 * etmemek icin dogru yol budur - KYC belgeleri (10 MB tavan, seyrek) icin
 * mevcut sunucu-uzerinden yol yeterliydi, urun gorselleri icin degil.
 *
 * GUVENLIK - API SECRET ISTEMCIYE HIC GITMEZ. Giden: cloud_name, api_key,
 * timestamp, signature ve KLASOR. Imza yalnizca { folder, timestamp } uzerine
 * atilir; istemci klasoru degistirirse imza tutmaz ve Cloudinary reddeder.
 * Yani "baska bir saticinin klasorune yukleme" bu imzayla yapilamaz.
 *
 * PUBLIC_ID IMZALANMAZ ve GONDERILMEMELIDIR: imzalansaydi istemci dosya adini
 * secip ayni klasordeki baska bir varligin uzerine yazabilirdi. Ad uretimini
 * Cloudinary'ye birakiyoruz.
 *
 * SURE: gecerlilik penceresi CLOUDINARY'NIN kuralidir - timestamp'i 1 saatten
 * eski olan istek reddedilir. Sunucu bunu KISALTAMAZ; gecerlilikSaniye alani
 * istemcinin "imzam bayatladi, yenisini iste" karari verebilmesi icin
 * dondurulen bilgidir, ek bir guvence degildir.
 */
export interface CloudinaryImza {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  uploadUrl: string;
  gecerlilikSaniye: number;
}

export function cloudinaryImzala(klasor: string): CloudinaryImza {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary yapilandirmasi eksik');
  }
  const timestamp = Math.floor(Date.now() / 1000);
  // Imzalanan alanlar ile istemcinin gonderecegi alanlar BIREBIR ayni olmali.
  const signature = cloudinary.utils.api_sign_request({ folder: klasor, timestamp }, apiSecret);
  return {
    cloudName,
    apiKey,
    timestamp,
    signature,
    folder: klasor,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    gecerlilikSaniye: 3600,
  };
}
