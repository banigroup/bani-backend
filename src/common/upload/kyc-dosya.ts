import { BadRequestException } from '@nestjs/common';

/**
 * KYC DOSYA DOGRULAMASI — IZIN VERILEN TURLER ACIK LISTEDE.
 *
 * Bugune kadar satici KYC yuklemesinde YALNIZ boyut siniri vardi (10 MB);
 * icerik turu hic bakilmiyordu. Yani .exe, .html ya da .svg bir dosya da
 * "vergi levhasi" olarak Cloudinary'ye gidebiliyordu. HTML/SVG ozellikle
 * onemli: Cloudinary bunlari servis ettiginde tarayicida CALISAN icerik olur.
 *
 * IKI KOSUL BIRLIKTE: bildirilen MIME turu listede olacak VE dosya adinin
 * uzantisi o MIME turune ait olacak. Tek basina MIME yetmez - istemci onu
 * serbestce yazar; tek basina uzanti da yetmez - ayni sekilde uydurulabilir.
 * Ikisinin TUTARLI olmasi sarti, "image/jpeg diyip .html gondermek" gibi
 * uyumsuz ciftleri eler.
 *
 * SIHIRLI BAYT (magic byte) OKUMASI BU TURUN KAPSAMINDA DEGIL: yeni bir
 * bagimlilik (file-type) gerektirir ve o paket bugun NestJS 11 yukseltmesine
 * bagli (backlog). MIME + uzanti kapisi, bugunku "hicbir kontrol yok"
 * durumuna gore acik bir kazanc ve geriye donuk uyumlu.
 *
 * LISTE NEDEN BU KADAR DAR: vergi levhasi, imza sirkuleri, ticaret sicil
 * gazetesi, kimlik, IBAN belgesi - hepsi pratikte PDF ya da telefonla
 * cekilmis bir fotograf. Daha genis bir liste, karsiligi olmayan bir saldiri
 * yuzeyi acardi.
 */
export const KYC_IZINLI_TURLER: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
};

/** Yuklenen dosyanin bu dogrulama icin gereken en dar sekli. */
export interface YuklenenDosya {
  originalname?: string;
  mimetype?: string;
  size?: number;
  buffer?: Buffer;
}

/** Dosya adinin son uzantisi, kucuk harfe indirilmis (nokta dahil). Yoksa ''. */
export function uzantiAl(dosyaAdi: string): string {
  const nokta = dosyaAdi.lastIndexOf('.');
  if (nokta <= 0 || nokta === dosyaAdi.length - 1) return '';
  return dosyaAdi.slice(nokta).toLowerCase();
}

/**
 * KYC belgesi olarak kabul edilebilir mi? Kabul edilmezse 400 firlatir.
 *
 * BOYUT SINIRINA DOKUNULMADI: 10 MB tavani multer'in FileInterceptor limiti
 * uyguluyor (market.controller) ve o kapi degismedi. Burada yalnizca TUR
 * kontrol edilir; iki kapi birbirinin yerine gecmez.
 */
export function kycDosyasiniDogrula(dosya: YuklenenDosya | undefined): void {
  if (!dosya) throw new BadRequestException('Dosya gerekli');

  const mime = (dosya.mimetype ?? '').toLowerCase().trim();
  const izinliUzantilar = KYC_IZINLI_TURLER[mime];
  if (!izinliUzantilar) {
    throw new BadRequestException(
      `Bu dosya türü kabul edilmiyor. İzin verilenler: PDF, JPG, PNG, WEBP, HEIC.`,
    );
  }

  const uzanti = uzantiAl(dosya.originalname ?? '');
  if (!uzanti) {
    throw new BadRequestException('Dosya adında uzantı yok; PDF veya fotoğraf yükleyin.');
  }
  if (!izinliUzantilar.includes(uzanti)) {
    throw new BadRequestException(
      `Dosya uzantısı (${uzanti}) içerik türüyle uyuşmuyor. PDF veya fotoğraf yükleyin.`,
    );
  }
}
