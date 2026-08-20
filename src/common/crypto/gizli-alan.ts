import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { InternalServerErrorException } from '@nestjs/common';

// GIZLI ALAN SIFRELEME — AES-256-GCM, uygulama katmani.
//
// Neden pgcrypto DEGIL: pgcrypto'da anahtar SQL metninin icine yazilir
// (pgp_sym_encrypt(deger, anahtar)); o metin sorgu logu, pg_stat_statements ve
// istemci taraf query cache'ine dusebilir. Uygulama katmaninda sifrelerken
// anahtar surecin bellegi disina hic cikmaz.
//
// Neden hash DEGIL: vergi kimligi GERI OKUNABILMELI (fatura kesme, GIB
// bildirimi). Projede mevcut sha256 deseni (otp.service, token.service) tek
// yonlu dogrulama icindir, burada ise kullanilamaz.
//
// Neden GCM: sifreli metnin degistirilmedigini de dogrular (authenticated
// encryption). CBC gibi bir mod sessiz bozulmaya acik olurdu.
const ALGORITMA = 'aes-256-gcm';
const IV_UZUNLUK = 12; // GCM icin onerilen nonce uzunlugu
const SURUM = 'v1';

export const ANAHTAR_ENV = 'VERGI_KIMLIK_ANAHTARI';

/**
 * Anahtar YALNIZCA ortam degiskeninden gelir; kodda ya da veritabaninda
 * varsayilan YOKTUR. Eksikse islem sessizce duz metin yazmak yerine HATA verir -
 * "sifreli sanilan ama duz duran" bir kolon en kotu sonuctur.
 */
function anahtar(): Buffer {
  const ham = process.env[ANAHTAR_ENV];
  if (!ham) {
    throw new InternalServerErrorException(
      `${ANAHTAR_ENV} tanimli degil; vergi kimligi sifrelenemez`,
    );
  }
  const buf = /^[0-9a-fA-F]{64}$/.test(ham) ? Buffer.from(ham, 'hex') : Buffer.from(ham, 'base64');
  if (buf.length !== 32) {
    throw new InternalServerErrorException(
      `${ANAHTAR_ENV} 32 bayt olmali (64 hex ya da base64); su an ${buf.length} bayt`,
    );
  }
  return buf;
}

/** Duz metni "v1:iv:tag:ciphertext" (hepsi base64) bicimine cevirir. */
export function sifrele(duzMetin: string): string {
  const iv = randomBytes(IV_UZUNLUK);
  const cipher = createCipheriv(ALGORITMA, anahtar(), iv);
  const sifreli = Buffer.concat([cipher.update(duzMetin, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SURUM, iv.toString('base64'), tag.toString('base64'), sifreli.toString('base64')].join(':');
}

/** Sifreli blogu geri cozer. Bozulmus ya da baska anahtarla yazilmis veri HATA verir. */
export function coz(blob: string): string {
  const parcalar = blob.split(':');
  if (parcalar.length !== 4 || parcalar[0] !== SURUM) {
    throw new InternalServerErrorException('Sifreli alan bicimi taninmiyor');
  }
  const [, ivB64, tagB64, ctB64] = parcalar;
  const decipher = createDecipheriv(ALGORITMA, anahtar(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Ekranda gosterim icin son 4 hane (sifreli alan cozulmeden listelenebilsin diye ayri saklanir). */
export function son4(duzMetin: string): string {
  return duzMetin.slice(-4);
}
