import { createHash } from 'crypto';

/**
 * GECICI TEST TELEFONU KAYIT DEFTERI — ANAHTAR BICIMI.
 *
 * Servis (NestJS, cache-manager uzerinden) ve persona uretici CLI
 * (scripts/create-test-seller-persona.js, kendi kisa omurlu ioredis baglantisi)
 * AYNI anahtari uretmek zorunda. Bu yuzden bicim TEK YERDE duruyor ve CLI
 * derlenmis halini (dist/...) require ediyor - iki tarafta ayri ayri yazilsaydi
 * biri degistiginde digeri sessizce kaymis olurdu.
 *
 * TELEFON ANAHTARDA ACIK DURMAZ: Redis'e erisen (ya da SCAN ciktisini goren)
 * biri hangi numaralarin test kapsaminda oldugunu okuyamasin diye sha256
 * ozeti kullaniliyor. Kayit defteri zaten "var mi yok mu" sorusuna cevap
 * veriyor; numaranin kendisi hicbir yerde gerekmiyor.
 */
export const TEST_TELEFON_ANAHTAR_ONEKI = 'dev-otp:test-phone:';

/** Varsayilan yetki suresi: owner'in canli gorsel testi icin 60 dakika. */
export const TEST_TELEFON_TTL_SANIYE = 60 * 60;

export function testTelefonAnahtari(telefon: string): string {
  const normal = (telefon ?? '').trim();
  return TEST_TELEFON_ANAHTAR_ONEKI + createHash('sha256').update(normal).digest('hex');
}
