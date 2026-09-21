/**
 * OWNER KABUL TESTI SABIT OTP'SI — KARAR FONKSIYONU (saf, yan etkisiz).
 *
 * TEK ISI: "bu numara icin rastgele kod yerine owner'in sabit kodu mu
 * uretilmeli?" sorusuna cevap vermek. Cevap evetse SABIT KODU, hayirsa null
 * doner. OtpService bu kodu NORMAL OTP satirina (hash + TTL + deneme sayaci +
 * tek kullanimlik) yazar; dogrulama yolu hic degismez - sabit kod da 5 hatali
 * denemede kilitlenir, suresi dolar, bir kez kullanilir.
 *
 * KAPALI BASARISIZ: iki degisken de tanimli ve bicimce gecerli degilse null
 * (normal OTP). Telefon E.164 degilse ya da kod OTP uzunlugunda rakam dizisi
 * degilse de null - yanlis girilmis bir config sessizce "herkese acik" bir
 * kapiya donusmez.
 *
 * YALNIZCA TAM ESLESME: `===`. Onek/sonek/normalizasyon YOK; config'deki
 * deger DTO'nun kabul ettigi E.164 bicimiyle birebir yazilmali.
 */
const E164 = /^\+[1-9]\d{9,14}$/;

export interface OwnerTestAyari {
  phone?: string | null;
  code?: string | null;
}

export function ownerTestKodu(phone: string, ayar: OwnerTestAyari, kodUzunlugu: number): string | null {
  const { phone: ownerTelefon, code: ownerKod } = ayar;
  if (typeof ownerTelefon !== 'string' || !E164.test(ownerTelefon)) return null;
  if (typeof ownerKod !== 'string' || !new RegExp(`^\\d{${kodUzunlugu}}$`).test(ownerKod)) return null;
  return phone === ownerTelefon ? ownerKod : null;
}
