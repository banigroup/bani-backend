// ============================================================
//  DicleFul / Bani Çarşı — Kargo Tarifesi
// ------------------------------------------------------------
//  Para birimi : BigInt KURUŞ  (×100 sakla, ÷100 göster)
//  Kural       : desi ve kg'dan HANGİSİ BÜYÜKSE o baz alınır.
//  Üst sınır   : 30 desi/kg üstü ŞİMDİLİK KABUL EDİLMEZ.
//
//  NOT: Fiyatlar örnektir; değiştirmek için aşağıdaki tabloyu
//       (feeKurus) güncellemen yeterli. İleride DB tablosuna
//       (ör. CargoTier) taşınabilir — yapı buna hazır.
//
//  Hedef dosya: cargo-pricing.ts  (taşıma için .tsx verildi)
// ============================================================

/** Kabul edilen en yüksek desi/kg değeri (dahil). */
export const CARGO_MAX_UNIT = 30;

export interface CargoTier {
  /** Bu kademenin üst sınırı (dahil). */
  maxUnit: number;
  /** Ücret — kuruş cinsinden (BigInt). */
  feeKurus: bigint;
}

/**
 * DicleFul kargo kademeleri. Bitişik aralıklar:
 *   0–5, 6–10, 11–15, 16–20, 21–25, 26–30
 * Lookup, "unit <= maxUnit" ile ilk eşleşen kademeyi bulur;
 * böylece kesirli desi (ör. 5.4) bir üst kademeye yuvarlanır.
 */
export const DICLEFUL_CARGO_TIERS: readonly CargoTier[] = [
  { maxUnit: 5, feeKurus: 41000n }, // 0–5    →   410,00 ₺
  { maxUnit: 10, feeKurus: 60600n }, // 6–10   →   606,00 ₺
  { maxUnit: 15, feeKurus: 78700n }, // 11–15  →   787,00 ₺
  { maxUnit: 20, feeKurus: 96700n }, // 16–20  →   967,00 ₺
  { maxUnit: 25, feeKurus: 126800n }, // 21–25  → 1.268,00 ₺
  { maxUnit: 30, feeKurus: 170000n }, // 26–30  → 1.700,00 ₺
] as const;

export type CargoFeeResult =
  | {
    ok: true;
    feeKurus: bigint;   // ödenecek kargo ücreti (kuruş)
    billedUnit: number; // faturalamada baz alınan değer (max desi/kg)
    tierMax: number;    // eşleşen kademenin üst sınırı
  }
  | {
    ok: false;
    reason: 'OVER_LIMIT' | 'INVALID_INPUT';
    message: string;
  };

/**
 * Kargo ücretini hesaplar.
 * @param desi Gönderinin desisi (hacimsel ağırlık)
 * @param kg   Gönderinin fiili ağırlığı (kg)
 */
export function calculateCargoFee(desi: number, kg: number): CargoFeeResult {
  if (
    !Number.isFinite(desi) ||
    !Number.isFinite(kg) ||
    desi < 0 ||
    kg < 0
  ) {
    return {
      ok: false,
      reason: 'INVALID_INPUT',
      message: 'Desi ve kg geçerli, sıfır veya pozitif sayılar olmalı.',
    };
  }

  // Hangisi büyükse onu baz al
  const unit = Math.max(desi, kg);

  // 30 desi/kg üstü: şimdilik kabul yok
  if (unit > CARGO_MAX_UNIT) {
    return {
      ok: false,
      reason: 'OVER_LIMIT',
      message: `Gönderi ${CARGO_MAX_UNIT} desi/kg sınırını aşıyor (${unit}). Şu an kabul edilmiyor.`,
    };
  }

  // İlk uygun kademeyi bul (unit <= maxUnit)
  const tier = DICLEFUL_CARGO_TIERS.find((t) => unit <= t.maxUnit);

  // unit <= 30 garanti olduğundan tier daima bulunur; yine de güvence:
  if (!tier) {
    return {
      ok: false,
      reason: 'OVER_LIMIT',
      message: 'Uygun kargo kademesi bulunamadı.',
    };
  }

  return {
    ok: true,
    feeKurus: tier.feeKurus,
    billedUnit: unit,
    tierMax: tier.maxUnit,
  };
}

/** Kuruş → "1.700,00" formatında TL metni (gösterim için). */
export function kurusToTL(kurus: bigint): string {
  const tl = Number(kurus) / 100;
  return tl.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ------------------------------------------------------------
//  Hızlı doğrulama örnekleri (silinebilir):
//
//  calculateCargoFee(3, 1)    → 41000n  (0–5)
//  calculateCargoFee(5.4, 2)  → 60600n  (5.4 > 5 → 6–10 kademesi)
//  calculateCargoFee(8, 12)   → 78700n  (max=12 → 11–15)
//  calculateCargoFee(30, 30)  → 170000n (26–30)
//  calculateCargoFee(31, 5)   → ok:false OVER_LIMIT
//  calculateCargoFee(-1, 5)   → ok:false INVALID_INPUT
// ------------------------------------------------------------
