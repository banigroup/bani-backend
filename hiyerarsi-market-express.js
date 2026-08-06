// Express kategori hiyerarsisi — TEK SEFERLIK, elle tetiklenir.
// Desen: mutabakat-market-express.js ile ayni (env kapisi + rapor/uygula + idempotent).
//
// TETIK: MARKET_HIYERARSI
//   (yok)   -> hicbir sey yapmaz. Normal deploy'larda olu koddur.
//   =rapor  -> HICBIR SEY YAZMAZ, yapilacaklari listeler.
//   =1      -> uygular.
//
// HEDEF YAPI (8 ana baslik + Atistirmalik altinda 3 cocuk):
//   1 Su & Icecek        5 Atistirmalik  ├ Cips  ├ Kuruyemis  └ Biskuvi & Cikolata
//   2 Sut & Kahvaltilik  6 Temizlik & Ev
//   3 Temel Gida         7 Kisisel Bakim
//   4 (bos)              [kapali] Meyve & Sebze  -> DOKUNULMAZ
//
// URUN TASINMAZ. Kategori silinmez. manav (Meyve & Sebze) kapali kalir.
// Idempotent: ikinci calistirmada tum sayaclar 0 doner.

const { MAGAZA_SLUG, envYukle } = require('./market-express-katalog');

const MOD = process.env.MARKET_HIYERARSI;
if (!MOD) {
  console.log('HIYERARSI: MARKET_HIYERARSI tanimli degil — atlandi.');
  process.exit(0);
}
const RAPOR = MOD === 'rapor';

envYukle(__dirname);

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Ana basliklar: slug -> { ad, sira }. Mevcut kategorilerin adi/sirasi buna hizalanir.
const ANA_BASLIKLAR = [
  ['icecekler', 'Su & İçecek', 1],
  ['sut-kahvaltilik', 'Süt & Kahvaltılık', 2],
  ['temel-gida', 'Temel Gıda', 3],
  ['atistirmalik', 'Atıştırmalık', 4],
  ['temizlik', 'Temizlik & Ev', 5],
  ['kisisel-bakim', 'Kişisel Bakım', 6],
];

// Atistirmalik'in cocuklari: slug -> { ad, sira }
const COCUKLAR = [
  ['atistirmalik-cips', 'Cips', 1],
  ['atistirmalik-kuruyemis', 'Kuruyemiş', 2],
  ['atistirmalik-biskuvi-cikolata', 'Bisküvi & Çikolata', 3],
];

const EBEVEYN_SLUG = 'atistirmalik';

async function main() {
  const store = await prisma.store.findUnique({ where: { slug: MAGAZA_SLUG } });
  if (!store) { console.log(`⚠️ ${MAGAZA_SLUG} bulunamadi — hiyerarsi atlandi.`); return; }

  const hepsi = await prisma.category.findMany({ where: { storeId: store.id } });
  const bySlug = new Map(hepsi.map((c) => [c.slug, c]));

  console.log(`=== HIYERARSI (${RAPOR ? 'RAPOR — yazma yok' : 'UYGULAMA'}) ===`);
  console.log(`Magaza: ${store.name} — kategori: ${hepsi.length}\n`);

  const ebeveyn = bySlug.get(EBEVEYN_SLUG);
  if (!ebeveyn) {
    console.log(`⚠️ '${EBEVEYN_SLUG}' kategorisi yok — Atistirmalik agaci kurulamaz.`);
  }

  const isler = [];

  // 1) Ana basliklarin ad / sira / aktiflik hizalamasi
  for (const [slug, ad, sira] of ANA_BASLIKLAR) {
    const c = bySlug.get(slug);
    if (!c) { console.log(`  ATLA (yok): ${slug}`); continue; }
    const data = {};
    if (c.name !== ad) data.name = ad;
    if (c.sortOrder !== sira) data.sortOrder = sira;
    if (c.parentId !== null) data.parentId = null;          // ana baslik cocuk olamaz
    if (slug === EBEVEYN_SLUG && !c.isActive) data.isActive = true; // mutabakatta kapanmisti
    if (Object.keys(data).length) isler.push({ c, data, not: `ana baslik: ${c.name} -> ${ad} (sira ${sira})` });
  }

  // 2) Cocuklari Atistirmalik'a bagla
  if (ebeveyn) {
    for (const [slug, ad, sira] of COCUKLAR) {
      const c = bySlug.get(slug);
      if (!c) { console.log(`  ATLA (yok): ${slug}`); continue; }
      const data = {};
      if (c.parentId !== ebeveyn.id) data.parentId = ebeveyn.id;
      if (c.name !== ad) data.name = ad;
      if (c.sortOrder !== sira) data.sortOrder = sira;
      if (!c.isActive) data.isActive = true;
      if (Object.keys(data).length) isler.push({ c, data, not: `cocuk: ${c.name} -> ${ad} (ebeveyn ${EBEVEYN_SLUG}, sira ${sira})` });
    }
  }

  console.log(`--- Yapilacak degisiklik: ${isler.length} ---`);
  for (const i of isler) console.log(`  ${i.c.slug.padEnd(32)} ${i.not}`);
  if (!isler.length) console.log('  (yok — yapi zaten hedefte)');

  // Dokunulmayanlar
  const dokunulmaz = hepsi.filter((c) => !isler.some((i) => i.c.id === c.id));
  console.log(`\n--- Dokunulmayan kategori: ${dokunulmaz.length} ---`);
  for (const c of dokunulmaz) {
    console.log(`  ${c.slug.padEnd(32)} ${c.name}${c.isActive ? '' : '  [kapali]'}`);
  }

  if (RAPOR) { console.log('\nRAPOR MODU — hicbir kayit degistirilmedi.'); return; }

  let guncellenen = 0;
  for (const i of isler) {
    await prisma.category.update({ where: { id: i.c.id }, data: i.data });
    guncellenen++;
  }
  console.log(`\nHIYERARSI TAMAM — ${guncellenen} kategori guncellendi. Urun tasinmadi, kategori silinmedi.`);
  console.log('Bitti: Railway degiskeni MARKET_HIYERARSI silinebilir.');
}

main()
  .catch((e) => { console.error('Hiyerarsi hata:', e); process.exit(0); })
  .finally(() => prisma.$disconnect());
