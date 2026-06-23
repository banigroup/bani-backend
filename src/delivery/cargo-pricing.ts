// ============================================================
//  DicleFul / Bani Carsi - Kargo Tarifesi
// ------------------------------------------------------------
//  Para birimi : BigInt KURUS  (x100 sakla, /100 goster)
//  Kural       : desi ve kg'dan HANGISI BUYUKSE o baz alinir.
//  Koli mantigi: 30 desi/kg = 1 tam koli (1700).
//                Asan kisim ayri hesaplanir.
//                Ornek: 35 -> 1 koli (1700) + kalan 5 (0-5 -> 410) = 2110
//                       60 -> 2 koli (3400), kalan 0
//                       65 -> 2 koli (3400) + kalan 5 (410) = 3810
//
//  Hedef dosya : cargo-pricing.ts  (tasima icin .tsx verildi)
// ============================================================

/** Bir tam kolinin ust siniri (dahil). */
export const CARGO_FULL_BOX_UNIT = 30;

export interface CargoTier {
  /** Bu kademenin ust siniri (dahil). */
  maxUnit: number;
  /** Ucret - kurus cinsinden (BigInt). */
  feeKurus: bigint;
}

/**
 * DicleFul kargo kademeleri (0-30 arasi).
 * 30 = tam koli ucreti (170000 kurus = 1700 TL).
 */
export const DICLEFUL_CARGO_TIERS: readonly CargoTier[] = [
  { maxUnit: 5, feeKurus: 41000n }, // 0-5    ->   410,00 TL
  { maxUnit: 10, feeKurus: 60600n }, // 6-10   ->   606,00 TL
  { maxUnit: 15, feeKurus: 78700n }, // 11-15  ->   787,00 TL
  { maxUnit: 20, feeKurus: 96700n }, // 16-20  ->   967,00 TL
  { maxUnit: 25, feeKurus: 126800n }, // 21-25  -> 1.268,00 TL
  { maxUnit: 30, feeKurus: 170000n }, // 26-30  -> 1.700,00 TL (= 1 tam koli)
] as const;

/** Tam koli ucreti (kurus) = 30 kademesinin degeri. */
export const FULL_BOX_FEE_KURUS = 170000n;

export type CargoFeeResult =
  | {
    ok: true;
    feeKurus: bigint; // toplam kargo ucreti (kurus)
    billedUnit: number; // faturalamada baz alinan deger (max desi/kg)
    fullBoxes: number; // tam koli sayisi
    remainder: number; // kalan desi/kg
  }
  | {
    ok: false;
    reason: 'INVALID_INPUT';
    message: string;
  };

/**
 * 0-30 arasi tek bir parcanin kademe ucretini bulur.
 * (unit her zaman > 0 ve <= 30 olmali)
 */
function tierFeeFor(unit: number): bigint {
  const tier = DICLEFUL_CARGO_TIERS.find((t) => unit <= t.maxUnit);
  // unit <= 30 garanti; yine de guvence
  return tier ? tier.feeKurus : FULL_BOX_FEE_KURUS;
}

/**
 * Kargo ucretini hesaplar.
 * 30 desi/kg = 1 tam koli; asan kisim kalan olarak ayri ucretlenir.
 * @param desi Gonderinin desisi (hacimsel agirlik)
 * @param kg   Gonderinin fiili agirligi (kg)
 */
export function calculateCargoFee(desi: number, kg: number): CargoFeeResult {
  if (!Number.isFinite(desi) || !Number.isFinite(kg) || desi < 0 || kg < 0) {
    return {
      ok: false,
      reason: 'INVALID_INPUT',
      message: 'Desi ve kg gecerli, sifir veya pozitif sayilar olmali.',
    };
  }

  // Hangisi buyukse onu baz al
  const unit = Math.max(desi, kg);

  // Bos sepet / sifir olcu -> ucret yok
  if (unit <= 0) {
    return { ok: true, feeKurus: 0n, billedUnit: 0, fullBoxes: 0, remainder: 0 };
  }

  // Tam koli sayisi + kalan
  const fullBoxes = Math.floor(unit / CARGO_FULL_BOX_UNIT);
  const remainder = unit - fullBoxes * CARGO_FULL_BOX_UNIT;

  let feeKurus = BigInt(fullBoxes) * FULL_BOX_FEE_KURUS;
  if (remainder > 0) {
    feeKurus += tierFeeFor(remainder);
  }

  return { ok: true, feeKurus, billedUnit: unit, fullBoxes, remainder };
}

/** Kurus -> "1.700,00" formatinda TL metni (gosterim icin). */
export function kurusToTL(kurus: bigint): string {
  const tl = Number(kurus) / 100;
  return tl.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ------------------------------------------------------------
//  Hizli dogrulama ornekleri (silinebilir):
//
//  calculateCargoFee(3, 1)    -> 41000n   (0-5)
//  calculateCargoFee(25, 0)   -> 126800n  (21-25)
//  calculateCargoFee(35, 0)   -> 211000n  (1 koli 170000 + 5->41000)
//  calculateCargoFee(60, 0)   -> 340000n  (2 koli, kalan yok)
//  calculateCargoFee(65, 0)   -> 381000n  (2 koli 340000 + 5->41000)
//  calculateCargoFee(0, 0)    -> 0n       (bos)
//  calculateCargoFee(-1, 5)   -> ok:false INVALID_INPUT
// ------------------------------------------------------------
