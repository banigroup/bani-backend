import { BusinessUnit } from '@prisma/client';

// ============================================================
// DIKEY -> DOMAIN HARITASI (frontend seo.ts HOST_ROTA'nin kucuk esdegeri)
// ------------------------------------------------------------
// Frontend'de harita "host -> rota" yonunde tutuluyor (proxy koku o rotaya
// yaziyor). Burada ayni gercegin ters yonu var: "dikey -> host". Ikisi ayni
// olguyu anlatir; markali bir domain eklenir/kaldirilirsa IKISI BIRDEN
// guncellenmelidir.
//
// Neden statik: domain -> dikey eslemesi sabit ve onceden bilinir. Veritabanina
// tasimak calisma zamaninda ekstra sorgu ve senkron sorunu getirirdi.
// ============================================================

export const ANA_DOMAIN = 'banigroup.com.tr';

/** Markali domaini olan dikeyler. Haritada olmayan dikey kisitlanmaz. */
export const DIKEY_DOMAIN: Partial<Record<BusinessUnit, string>> = {
  [BusinessUnit.MARKET]: 'banimarket.com.tr',
  [BusinessUnit.YEMEK]: 'baniyemek.com.tr',
  [BusinessUnit.CARSI]: 'banikervan.com.tr',
  [BusinessUnit.COFFEE]: 'banicoffee.com.tr',
  [BusinessUnit.LOAD]: 'baniload.com.tr',
  [BusinessUnit.DICLEFUL]: 'diclefulfillment.com.tr',
};

/**
 * Markali domain -> dikey. DIKEY_DOMAIN'in tersi; elle degil turetilerek tutulur
 * ki iki harita birbirinden ayrisamasin.
 */
const DOMAIN_DIKEY: Record<string, BusinessUnit> = Object.fromEntries(
  Object.entries(DIKEY_DOMAIN).map(([dikey, host]) => [host, dikey as BusinessUnit]),
);

/** Origin basligindan host cikarir: www ve port atilir, kucuk harfe inilir. */
export function originHost(origin?: string): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null; // 'null' string'i ya da bozuk deger
  }
}

/**
 * Origin markali bir dikeye aitse o dikeyi doner. Ana domain her dikeyi sundugu
 * icin oradan gelen istekte dikey ORIGIN'DEN CIKARILAMAZ -> null.
 */
export function originDikey(origin?: string): BusinessUnit | null {
  const host = originHost(origin);
  if (!host) return null;
  return DOMAIN_DIKEY[host] ?? null;
}

/** Istemcinin bildirdigi serbest metni enum degerine cevirir; taninmayan deger null. */
export function dikeyAyristir(deger?: string): BusinessUnit | null {
  if (!deger) return null;
  const buyuk = deger.trim().toUpperCase();
  return (Object.values(BusinessUnit) as string[]).includes(buyuk)
    ? (buyuk as BusinessUnit)
    : null;
}

/**
 * Sepet islemleri icin dikeyi cozer.
 *
 * SIRA: origin (markali domainse) > istemci basligi. Origin markali bir domainse
 * OTORITERDIR - kullanici banimarket.com.tr'deyken market sepetini gormeli,
 * baslik ne derse desin. Ikisi de coz(e)mezse null doner; cagiran taraf o zaman
 * gecis kuralini uygular (bkz. CartService.sepetCoz).
 *
 * NOT: urun eklemede dikey BURADAN alinmaz - urunun magazasinin dikeyi
 * otoriterdir; boylece istemci basligiyla oynayarak sepeti yanlis dikeye
 * yazamaz.
 */
export function dikeyCoz(origin?: string, baslik?: string): BusinessUnit | null {
  return originDikey(origin) ?? dikeyAyristir(baslik);
}

export interface OriginKontrolSonuc {
  uygun: boolean;
  beklenenDomain?: string;
}

/**
 * Checkout icin origin/dikey tutarliligi.
 *
 * KURAL: ana domain HER dikeyi sunmaya devam ediyor (banigroup.com.tr/market
 * calisan bir adres; proxy yalnizca markali domainlerin KOK istegini dikeye
 * yaziyor). Bu yuzden gecerli olan iki durum var:
 *   1. Origin ana domain
 *   2. Origin, sepetteki magazanin dikeyine ait markali domain
 * Reddedilen tek durum BASKA bir dikeyin markali domaini.
 *
 * Origin YOKSA kontrol atlanir. Gerekce: bu bir yetki siniri degil - yetki
 * JWT'de. Amaci, kullanicinin yanlis marka vitrininde odeme yapmasini
 * onlemek. Tarayici disi istemciler (mobil uygulama, sunucu-sunucu cagri)
 * Origin gondermez ve onlari kirmanin bir faydasi olmaz.
 */
export function checkoutOriginUygun(origin: string | undefined, dikey: BusinessUnit): OriginKontrolSonuc {
  const host = originHost(origin);
  if (!host) return { uygun: true };
  if (host === ANA_DOMAIN) return { uygun: true };
  // Yerel gelistirme yalnizca uretim disinda serbest.
  if (process.env.NODE_ENV !== 'production' && (host === 'localhost' || host === '127.0.0.1')) {
    return { uygun: true };
  }
  const beklenenDomain = DIKEY_DOMAIN[dikey];
  if (!beklenenDomain) return { uygun: true }; // markali domaini olmayan dikey
  if (host === beklenenDomain) return { uygun: true };
  return { uygun: false, beklenenDomain };
}
