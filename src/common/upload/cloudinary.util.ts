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
