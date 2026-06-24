// Bani Carsi - Vitrin fiyati hesaplama (kargo gomulu + komisyon + KDV)
// Tum para birimi: KURUS (BigInt). net 100 TL = 10000n.

// --- Kademe kargo tarifesi (ORNEK rakamlar, sonra degisecek) ---
// max(desi, kg) hangi araliga duserse o sabit ucret. 30 ustu KABUL YOK.
const KARGO_TARIFE: { max: number; kurus: bigint }[] = [
  { max: 5, kurus: 3000n },   // 0-5   -> 30 TL
  { max: 10, kurus: 5000n },  // 6-10  -> 50 TL
  { max: 15, kurus: 7000n },  // 11-15 -> 70 TL
  { max: 20, kurus: 10000n }, // 16-20 -> 100 TL
  { max: 25, kurus: 13000n }, // 21-25 -> 130 TL
  { max: 30, kurus: 15000n }, // 26-30 -> 150 TL
];

const KOMISYON_ORAN = 15n; // %15
const HIZMET_KDV_ORAN = 20n; // %20

export type FiyatSonuc =
  | {
      ok: true;
      vitrinKurus: bigint; // musterinin gordugu fiyat
      netKurus: bigint;    // saticiya kalan
      komisyonKurus: bigint;
      kargoKurus: bigint;
      kdvKurus: bigint;
    }
  | { ok: false; sebep: string };

// max(desi,kg) -> kademe kargo ucreti (kurus). 30 ustu null.
function kargoKurusHesapla(desi: number, kg: number): bigint | null {
  const birim = Math.max(desi || 0, kg || 0);
  if (birim <= 0) return 0n;
  if (birim > 30) return null; // 30 ustu kabul yok
  const k = KARGO_TARIFE.find((t) => birim <= t.max);
  return k ? k.kurus : null;
}

/**
 * Vitrin fiyatini hesaplar.
 * @param netKurus    saticinin girdigi net fiyat (kurus)
 * @param desi        urun desisi
 * @param kg          urun agirligi (kg)
 * @param satisModeli "A" = kendi urun, "B" = dropshipping
 */
export function vitrinFiyatHesapla(
  netKurus: bigint,
  desi: number,
  kg: number,
  satisModeli: string,
): FiyatSonuc {
  if (netKurus < 0n) return { ok: false, sebep: 'Net fiyat gecersiz' };

  const kargoKurus = kargoKurusHesapla(desi, kg);
  if (kargoKurus === null) {
    return { ok: false, sebep: '30 desi/kg ustu kabul edilmiyor' };
  }

  const komisyonKurus = (netKurus * KOMISYON_ORAN) / 100n;

  // Hizmet KDV'si:
  //  A (kendi urun): (komisyon + kargo) uzerinden
  //  B (dropship):   sadece komisyon uzerinden
  const kdvTaban = satisModeli === 'B' ? komisyonKurus : komisyonKurus + kargoKurus;
  const kdvKurus = (kdvTaban * HIZMET_KDV_ORAN) / 100n;

  const vitrinKurus = netKurus + komisyonKurus + kargoKurus + kdvKurus;

  return { ok: true, vitrinKurus, netKurus, komisyonKurus, kargoKurus, kdvKurus };
}
