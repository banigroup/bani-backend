// VARYANT ETKIN DEGER COZUMU — TEK KAYNAK.
//
// Faz 3 karari: varyant OPSIYONEL. Fiyat/stok/muhasebe kirilimi varyantta
// tutulabilir; varyantta NULL ise urunun degeri gecerlidir.
//
// Bu kural bes ayri yerde (sepete ekleme, sepet goruntusu, checkout stok
// kontrolu, Carsi kirilimi, stok dusumu) gerekiyor. isAdmin'in iki dosyada
// ayrisip ADMIN'i kilitlemesi ornegindeki gibi ikinci bir kopya yazilmadi:
// kural burada TEK.
//
// VARYANTSIZ URUNDE SONUC DEGISMEZ: variant undefined/null oldugunda her
// fonksiyon urunun kendi degerini dondurur, yani Faz 3 oncesi davranisin
// birebir aynisi.

export interface VaryantFiyatKaynagi {
  price: bigint;
  netFiyat: bigint;
  komisyonTutari: bigint;
  kargoTutari: bigint;
  malKdvTutari: bigint;
  hizmetKdvTutari: bigint;
}

export interface VaryantDegerleri {
  price?: bigint | null;
  stock?: number | null;
  netFiyat?: bigint | null;
  komisyonTutari?: bigint | null;
  kargoTutari?: bigint | null;
  malKdvTutari?: bigint | null;
  hizmetKdvTutari?: bigint | null;
}

/** Satis fiyati: varyantinki varsa o, yoksa urunun fiyati. */
export function etkinFiyat(urun: { price: bigint }, varyant?: VaryantDegerleri | null): bigint {
  return varyant?.price ?? urun.price;
}

/** Satilabilir stok: varyantinki varsa o, yoksa urunun stogu. */
export function etkinStok(urun: { stock: number }, varyant?: VaryantDegerleri | null): number {
  return varyant?.stock ?? urun.stock;
}

/**
 * Carsi muhasebe kirilimi. Kalemler AYRI AYRI cozulur, blok halinde degil:
 * varyantta yalnizca fiyat tanimlanip kirilim bos birakilabilir; o durumda
 * kirilim urunden gelir ve checkout'taki "dagitim == subtotal" guvencesi
 * bozulmadan calisir.
 */
export function etkinKirilim(
  urun: VaryantFiyatKaynagi,
  varyant?: VaryantDegerleri | null,
): VaryantFiyatKaynagi {
  return {
    price: varyant?.price ?? urun.price,
    netFiyat: varyant?.netFiyat ?? urun.netFiyat,
    komisyonTutari: varyant?.komisyonTutari ?? urun.komisyonTutari,
    kargoTutari: varyant?.kargoTutari ?? urun.kargoTutari,
    malKdvTutari: varyant?.malKdvTutari ?? urun.malKdvTutari,
    hizmetKdvTutari: varyant?.hizmetKdvTutari ?? urun.hizmetKdvTutari,
  };
}
