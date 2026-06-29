// Bani Çarşı — Vitrin fiyatı hesaplama (kargo + komisyon + KDV gömülü)
// Tüm para birimi: KURUŞ (BigInt). net 100 TL = 10000n.
// Hesaplanan tüm kalemler ayrı ayrı döner; CatalogService bunları
// Product kolonlarına (komisyonTutari / kargoTutari / malKdvTutari /
// hizmetKdvTutari) yazar. Muhasebe ayrıştırması için bu şart.

// ============================================================
// 1) DicleFul desi tarifesi — 0..50 desi (KURUŞ)
//    index = desi. 0 = taban ücret. 50 üstü için aşağıdaki formül.
// ============================================================
const DESI_TARIFE_KURUS: bigint[] = [
  12061n, // 0
  12061n, // 1
  12367n, // 2
  13148n, // 3
  13412n, // 4
  14976n, // 5
  15499n, // 6
  17504n, // 7
  18250n, // 8
  19335n, // 9
  20201n, // 10
  22162n, // 11
  23642n, // 12
  24560n, // 13
  26475n, // 14
  28128n, // 15
  28909n, // 16
  30564n, // 17
  31700n, // 18
  32612n, // 19
  33618n, // 20
  35273n, // 21
  36928n, // 22
  37619n, // 23
  38497n, // 24
  41451n, // 25
  45852n, // 26
  47505n, // 27
  48815n, // 28
  49335n, // 29
  51165n, // 30
  52605n, // 31
  54083n, // 32
  55520n, // 33
  56953n, // 34
  58435n, // 35
  59919n, // 36
  61354n, // 37
  62790n, // 38
  64270n, // 39
  65752n, // 40
  67187n, // 41
  68629n, // 42
  70109n, // 43
  71544n, // 44
  73024n, // 45
  74460n, // 46
  75939n, // 47
  77383n, // 48
  78858n, // 49
  80294n, // 50
];

// 50 desi üstü: her ek desi için +14 TL (1400 kuruş)
const DESI_USTU_BIRIM_KURUS = 1400n;

// max(desi, kg) -> kademe kargo ücreti (kuruş).
// Ürün seviyesinde tarife tamsayı desi ile çalışır; küsürat YUKARI yuvarlanır.
function kargoKurusHesapla(desi: number, kg: number): bigint {
  const birim = Math.max(desi || 0, kg || 0, 0);
  const yuvarli = Math.ceil(birim); // 2.4 desi -> 3. desi satırı
  if (yuvarli <= 50) return DESI_TARIFE_KURUS[yuvarli];
  return DESI_TARIFE_KURUS[50] + DESI_USTU_BIRIM_KURUS * BigInt(yuvarli - 50);
}

// ============================================================
// 2) Kategori bazlı OTOMATİK KDV tanıma
//    Anahtar kelime -> KDV oranı (%). Bani Çarşı kategori tablosu (2026).
//
//    ⚠️ UYARI: Otomatik tanıma SADECE öneridir. Yanlış oran = yanlış fatura.
//    - Satıcı DTO'da açık kdvOrani gönderirse o ezer (öncelikli).
//    - Eşleşme yoksa güvenli üst oran %20'ye düşülür (otomatik:false).
//    - Ürün isActive:false ile admin onayına gider; oran orada teyit edilmeli.
//
//    Listeler genişletilebilir; sıra ÖNEMLİDİR (ilk eşleşen kazanır),
//    o yüzden daha spesifik kelimeleri üste koy.
// ============================================================
type KdvKural = { oran: number; etiket: string; anahtarlar: string[] };

const KDV_KURALLARI: KdvKural[] = [
  // %1 — Taze / işlenmemiş gıda
  {
    oran: 1,
    etiket: 'Taze gıda',
    anahtarlar: [
      'taze', 'sebze', 'meyve', 'domates', 'salatalik', 'patates', 'sogan',
      'elma', 'muz', 'portakal', 'limon', 'uzum', 'cilek',
      'et ', 'kirmizi et', 'kiyma', 'tavuk', 'hindi', 'balik', 'somon',
      'sut', 'yumurta', 'peynir', 'yogurt',
      'ekmek', 'somun', 'bazlama', 'unlu mamul',
    ],
  },
  // %10 — İşlenmiş / paketli gıda
  {
    oran: 10,
    etiket: 'İşlenmiş gıda',
    anahtarlar: [
      'atistirmalik', 'cips', 'kraker', 'biskuvi', 'cikolata', 'gofret',
      'konserve', 'hazir yemek', 'salca', 'recel',
      'kahve', 'cay', 'icecek', 'gazoz', 'meyve suyu', 'soda',
    ],
  },
  // %10 — Tekstil & moda
  {
    oran: 10,
    etiket: 'Tekstil & moda',
    anahtarlar: [
      'giyim', 'tisort', 't-shirt', 'gomlek', 'pantolon', 'elbise', 'etek',
      'kazak', 'mont', 'ceket', 'ic giyim', 'corap',
      'ayakkabi', 'bot', 'terlik', 'sandalet', 'spor ayakkabi',
      'canta', 'cuzdan', 'kemer', 'aksesuar', 'sapka',
    ],
  },
  // %10 — Mobilya
  {
    oran: 10,
    etiket: 'Mobilya',
    anahtarlar: [
      'mobilya', 'koltuk', 'kanepe', 'masa', 'sandalye', 'dolap', 'gardrop',
      'yatak', 'baza', 'komodin', 'sehpa', 'kitaplik', 'tv unitesi',
    ],
  },
  // %20 — Kozmetik & kişisel bakım
  {
    oran: 20,
    etiket: 'Kozmetik & bakım',
    anahtarlar: [
      'kozmetik', 'parfum', 'parfom', 'krem', 'serum', 'maske',
      'sampuan', 'sac bakim', 'cilt bakim', 'makyaj', 'ruj', 'oje',
      'deodorant', 'tras',
    ],
  },
  // %20 — Elektronik
  {
    oran: 20,
    etiket: 'Elektronik',
    anahtarlar: [
      'telefon', 'akilli telefon', 'cep telefonu', 'bilgisayar', 'laptop',
      'tablet', 'monitor', 'tv', 'televizyon', 'kulaklik', 'sarj',
      'beyaz esya', 'buzdolabi', 'camasir makine', 'bulasik makine', 'firin',
    ],
  },
  // %20 — Ev gereçleri
  {
    oran: 20,
    etiket: 'Ev gereçleri',
    anahtarlar: [
      'tencere', 'tava', 'bardak', 'tabak', 'catal', 'kasik', 'bicak',
      'ev gerec', 'mutfak gerec', 'sofra', 'pespaye',
    ],
  },
];

// Eşleşme bulunamazsa: güvenli üst oran.
const VARSAYILAN_KDV = 20;

export type KdvBilgi = { oran: number; etiket: string; otomatik: boolean };

/**
 * Ürün adı (+ varsa kategori adı) üzerinden KDV oranını otomatik tanır.
 * @returns oran (%), insan-okur etiket, ve otomatik=true/false
 *          (false => eşleşme yok, varsayılan %20 uygulandı, admin baksın)
 */
export function kdvOraniBul(urunAdi: string, kategoriAdi?: string): KdvBilgi {
  const metin = `${urunAdi ?? ''} ${kategoriAdi ?? ''}`.toLocaleLowerCase('tr-TR');
  for (const kural of KDV_KURALLARI) {
    if (kural.anahtarlar.some((a) => metin.includes(a))) {
      return { oran: kural.oran, etiket: kural.etiket, otomatik: true };
    }
  }
  return { oran: VARSAYILAN_KDV, etiket: 'Belirlenemedi (varsayılan %20)', otomatik: false };
}

// ============================================================
// 3) Vitrin fiyatı + ayrıştırılmış muhasebe kalemleri
// ============================================================
const KOMISYON_ORAN = 8n; // %8 — net (KDV hariç) üzerinden (Bani Çarşı)
const HIZMET_KDV_ORAN = 20n; // %20 — komisyon (+ A modelinde kargo) üzerinden

export type FiyatSonuc =
  | {
    ok: true;
    vitrinKurus: bigint; // müşterinin ödediği (tam liraya YUKARI yuvarlı)
    netKurus: bigint; // satıcının net fiyatı
    komisyonKurus: bigint; // platform komisyonu = net × %8
    kargoKurus: bigint; // gömülü kargo (DicleFul tarifesi)
    malKdvKurus: bigint; // SATICININ KDV'si = net × kategori oranı
    hizmetKdvKurus: bigint; // PLATFORMUN KDV'si = (komisyon[+kargo]) × %20
    yuvarlamaKurus: bigint; // tam liraya yukarı yuvarlama farkı (<100 kuruş)
  }
  | { ok: false; sebep: string };

/**
 * Vitrin fiyatını hesaplar (kargo + komisyon + her iki KDV gömülü).
 * @param netKurus     satıcının girdiği net fiyat (kuruş, KDV hariç)
 * @param desi         ürün desisi
 * @param kg           ürün ağırlığı (kg)
 * @param satisModeli  "A" = kendi ürün, "B" = dropshipping
 * @param kdvOrani     ürünün kategori KDV oranı (1 / 10 / 20)
 */
export function vitrinFiyatHesapla(
  netKurus: bigint,
  desi: number,
  kg: number,
  satisModeli: string,
  kdvOrani: number,
): FiyatSonuc {
  if (netKurus < 0n) return { ok: false, sebep: 'Net fiyat geçersiz' };

  const kargoKurus = kargoKurusHesapla(desi, kg);
  const komisyonKurus = (netKurus * KOMISYON_ORAN) / 100n;

  // Malın KDV'si: satıcının beyanı. Net × kategori oranı.
  const malKdvKurus = (netKurus * BigInt(kdvOrani)) / 100n;

  // Hizmet KDV'si: platformun beyanı.
  //  A (kendi ürün): (komisyon + kargo) üzerinden
  //  B (dropship):   sadece komisyon üzerinden
  const hizmetTaban = satisModeli === 'B' ? komisyonKurus : komisyonKurus + kargoKurus;
  const hizmetKdvKurus = (hizmetTaban * HIZMET_KDV_ORAN) / 100n;

  const hamToplam =
    netKurus + komisyonKurus + kargoKurus + malKdvKurus + hizmetKdvKurus;

  // Tam liraya YUKARI yuvarla (100 kuruş = 1 TL). 4949,63 -> 4950,00
  const vitrinKurus = ((hamToplam + 99n) / 100n) * 100n;
  const yuvarlamaKurus = vitrinKurus - hamToplam;

  return {
    ok: true,
    vitrinKurus,
    netKurus,
    komisyonKurus,
    kargoKurus,
    malKdvKurus,
    hizmetKdvKurus,
    yuvarlamaKurus,
  };
}
