// KDV motoru testi — SAF, veritabanina DOKUNMAZ.
// Calistir: npm run build && node test-kdv.js
//
// Kapsam:
//   A) 'et ' yanlis eslesmesi (tablet/paket/sepet/market/kabinet -> %1 donmemeli)
//   B) Turkce normalizasyon (Sut/Tisort/Canta gerçek adlariyla kurala takilmali)
//   C) Kervan kategorileri (Kitap %0 istisna dahil)
//   D) Mevcut davranisin korunmasi (gida/tekstil/mobilya regresyonu)

const { kdvOraniBul } = require('./dist/src/delivery/pricing.js');

// [urunAdi, kategoriAdi, beklenenOran, beklenenOtomatik, aciklama]
const VAKALAR = [
  // --- A) 'et ' yanlis eslesmesi: hicbiri %1 olmamali ---
  ['Tablet Bilgisayar', 'Elektronik', 20, true, "'et ' hatasi: tablet"],
  ['Paket Servis Kutusu', 'Ev & Yaşam', 20, null, "'et ' hatasi: paket"],
  ['Sepet Hasır', 'Ev & Yaşam', 20, null, "'et ' hatasi: sepet"],
  ['Market Arabası', 'Ev & Yaşam', 20, null, "'et ' hatasi: market"],
  ['Kabinet Dolap', 'Ev & Yaşam', 10, true, "'et ' hatasi: kabinet -> mobilya"],
  ['Palet Sehpa', 'Ev & Yaşam', 10, true, "'et ' hatasi: palet -> mobilya"],

  // --- B) Turkce normalizasyon ---
  ['Süt 1L', 'Süt & Kahvaltılık', 1, true, 'Turkce: süt -> taze gida'],
  ['Tişört Basic', 'Moda', 10, true, 'Turkce: tişört -> tekstil'],
  ['Çanta Deri', 'Moda', 10, true, 'Turkce: çanta -> tekstil'],
  ['Kablosuz Kulaklık', 'Elektronik', 20, true, 'Turkce: kulaklık -> elektronik'],
  ['Şampuan 400ml', 'Kozmetik', 20, true, 'Turkce: şampuan -> kozmetik'],
  ['Bıçak Seti', 'Ev & Yaşam', 20, true, 'Turkce: bıçak -> ev gerecleri'],

  // --- C) Kervan kategorileri ---
  ['Roman Kitap', 'Kitap & Kırtasiye', 0, true, 'Kitap KDV ISTISNA (%0)'],
  ['Ansiklopedi Seti', 'Kitap & Kırtasiye', 0, true, 'Kitap istisna: ansiklopedi'],
  ['Aylık Dergi', 'Kitap & Kırtasiye', 0, true, 'Kitap istisna: dergi'],
  ['Defter A4', 'Kitap & Kırtasiye', 20, true, 'Kirtasiye %20 (kitap kategorisinde olsa bile)'],
  ['Kurşun Kalem', 'Kitap & Kırtasiye', 20, true, 'Kirtasiye %20'],
  ['Bakır Cezve', 'Yöresel & El Sanatları', 20, true, 'Yoresel -> %20'],
  ['El Dokuma Kilim', 'Yöresel & El Sanatları', 20, true, 'Yoresel -> %20'],
  ['Bebek Bezi', 'Anne & Bebek', 20, true, 'Anne & bebek -> %20 (otomatik)'],
  ['Ahşap Puzzle', 'Oyuncak & Hobi', 20, true, 'Oyuncak -> %20 (otomatik)'],
  ['Yoga Matı', 'Spor & Outdoor', 20, true, 'Spor -> %20 (otomatik)'],
  ['Motor Yağı', 'Oto & Bahçe & Yapı', 20, true, 'Oto/bahce/yapi -> %20 (otomatik)'],
  ['Akıllı Telefon', 'Elektronik', 20, true, 'Elektronik kategori adi anahtari'],
  ['Yazlık Elbise', 'Moda', 10, true, 'Moda kategori adi anahtari'],

  // --- D) Regresyon: mevcut davranis korunmali ---
  ['Kırmızı Et 1kg', 'Kasap', 1, true, 'Gercek et hala %1'],
  ['Dana Eti Kuşbaşı', 'Kasap', 1, true, 'Dana eti %1'],
  ['Domates 1kg', 'Meyve & Sebze', 1, true, 'Taze gida %1'],
  ['Ekmek 250g', 'Temel Gıda', 1, true, 'Ekmek %1'],
  ['Sütlü Tablet Çikolata 80g', 'Atıştırmalık', 10, true, 'Islenmis gida %10 (sut/tablet tuzagi)'],
  ['Meyve Suyu Karışık 1L', 'Su & İçecek', 10, true, 'Meyve suyu islenmis %10'],
  ['Çay 1kg', 'Temel Gıda', 10, true, 'Cay islenmis %10'],
  ['Koltuk Takımı', 'Ev & Yaşam', 10, true, 'Mobilya %10'],
  ['Spor Ayakkabı', 'Spor & Outdoor', 10, true, 'Ayakkabi tekstil %10'],
];

let gecen = 0, kalan = 0;
console.log('urun'.padEnd(30) + 'kategori'.padEnd(24) + 'bkl'.padStart(4) + 'snc'.padStart(5) + '  oto   durum  aciklama');
console.log('-'.repeat(118));

for (const [ad, kat, beklenen, beklenenOto, aciklama] of VAKALAR) {
  const r = kdvOraniBul(ad, kat);
  const oranOk = r.oran === beklenen;
  const otoOk = beklenenOto === null || r.otomatik === beklenenOto;
  const ok = oranOk && otoOk;
  if (ok) gecen++; else kalan++;
  console.log(
    ad.padEnd(30) + kat.padEnd(24) +
    String('%' + beklenen).padStart(4) + String('%' + r.oran).padStart(5) +
    '  ' + String(r.otomatik).padEnd(5) + '  ' + (ok ? ' OK  ' : 'HATA ') + '  ' + aciklama,
  );
}

console.log('-'.repeat(118));
console.log(`SONUC: ${gecen} gecti, ${kalan} kaldi (toplam ${VAKALAR.length})`);
process.exit(kalan === 0 ? 0 : 1);
