// ODEME SAGLAYICI SOYUTLAMASI — SMS_PROVIDER ile ayni desen:
// Symbol token + dar arayuz + env'e gore secilen implementasyon.
//
// IKI ADIMLI (initiate -> verify) olmasinin sebebi 3D Secure'dur: gercek
// saglayicida (iyzico) kart dogrulamasi banka sayfasinda yapilir, sonuc bize
// callback ile doner. Tek adimli bir charge() arayuzu iyzico takildiginda
// kirilirdi; bu yuzden bastan iki adimli kuruldu. Sandbox'ta ikinci adim
// aninda basarili doner, akis yine de gercekteki gibi iki cagridir.
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface OdemeBaslatGirdi {
  userId: string;
  tutarKurus: bigint;
  aciklama?: string;
}

export interface OdemeBaslatSonuc {
  // Saglayicinin urettigi TEKIL referans. Ledger'a bu yazilir - istemciden
  // gelen bir deger ASLA reference olarak kullanilmaz (idempotency anahtari
  // istemcinin eline gecerse ayni tahsilat birden fazla kez islenebilir).
  saglayiciRef: string;
  // 3DS gerekiyorsa YONLENDIR + yonlendirmeUrl; gerekmiyorsa DOGRULAMAYA_HAZIR.
  durum: 'YONLENDIR' | 'DOGRULAMAYA_HAZIR';
  yonlendirmeUrl?: string;
}

export interface OdemeDogrulaGirdi {
  saglayiciRef: string;
  // Referansi baslatan kullanici. Saglayici, ref'in bu kullaniciya ait oldugunu
  // dogrulamalidir: aksi halde baskasinin referansiyla kendi cuzdanina bakiye
  // yazdirmak mumkun olurdu.
  userId: string;
  // 3DS donusunde saglayicinin gonderdigi govde (iyzico icin conversationId,
  // mdStatus vb.). Sandbox bunu kullanmaz ama arayuz gercek akisi karsilamali.
  saglayiciYaniti?: Record<string, unknown>;
}

export interface OdemeDogrulaSonuc {
  saglayiciRef: string;
  basarili: boolean;
  // TAHSIL EDILEN tutar saglayicidan gelir, istemciden DEGIL. Istemci beyanina
  // guvenilseydi 1 TL odeyip 1000 TL bakiye yazdirmak mumkun olurdu.
  tahsilEdilenKurus: bigint;
  hataKodu?: string;
  hataMesaji?: string;
}

export interface PaymentProvider {
  initiate(girdi: OdemeBaslatGirdi): Promise<OdemeBaslatSonuc>;
  verify(girdi: OdemeDogrulaGirdi): Promise<OdemeDogrulaSonuc>;
}
