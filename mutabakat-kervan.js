// Kervan yoresel hiyerarsisi — TEK SEFERLIK, elle tetiklenir.
// Desen: mutabakat-market-express.js ile ayni (env kapisi + rapor/uygula + idempotent).
//
// TETIK: KERVAN_MUTABAKAT
//   (yok)   -> hicbir sey yapmaz. Normal deploy'larda olu koddur.
//   =rapor  -> HICBIR SEY YAZMAZ, yapilacaklari listeler.
//   =1      -> uygular.
//
// YAPILANLAR:
//   1) 'el-emegi' kategorisinin adi "Yöresel & El Sanatları" olur. SLUG KORUNUR.
//   2) 5 alt kategori (Bakir & Metal / Tekstil & Dokuma / Seramik & Ahsap /
//      Taki / Dogal Urunler) el-emegi'ne baglanir. (create-kervan.js zaten
//      acar; burada eksikse tamamlanir ve parentId garanti edilir.)
//   3) Mevcut 12 yoresel urun alt kategorilere TASINIR (yalnizca categoryId).
//
// DOKUNULMAYANLAR: fiyat, netFiyat, desi, kg, kdvOrani, stock, isActive.
//   Mevcut 12 urunun hesaplanmis fiyat/desi verisi korunur (kullanici karari).
//   Rapor modunda, turetilen KDV ile kayitli KDV karsilastirmali gosterilir —
//   fark varsa bilgi amaclidir, otomatik DUZELTILMEZ.
//
// Idempotent: ikinci calistirmada tum sayaclar 0 doner.

const { MAGAZA_SLUG, envYukle, KATALOG } = require('./kervan-katalog');

const MOD = process.env.KERVAN_MUTABAKAT;
if (!MOD) {
  console.log('KERVAN MUTABAKAT: KERVAN_MUTABAKAT tanimli degil — atlandi.');
  process.exit(0);
}
const RAPOR = MOD === 'rapor';

envYukle(__dirname);

let pricing;
try { pricing = require('./dist/src/delivery/pricing'); }
catch (e1) { try { pricing = require('./dist/delivery/pricing'); } catch (e2) { pricing = null; } }

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UST_SLUG = 'el-emegi';
const UST_AD = 'Yöresel & El Sanatları';

// Mevcut 12 urunun hedef alt kategorisi (kullanici onayli dagilim)
const TASIMA = {
  'bakir-gugum': 'bakir-metal',
  'bakir-tepsi': 'bakir-metal',
  'bakir-cezve': 'bakir-metal',
  'el-dokuma-kilim': 'tekstil-dokuma',
  'yun-battaniye': 'tekstil-dokuma',
  'el-orgusu-corap': 'tekstil-dokuma',
  'kilim-yastik': 'tekstil-dokuma',
  'kece-terlik': 'tekstil-dokuma',
  'seramik-kase': 'seramik-ahsap',
  'ahsap-tabak': 'seramik-ahsap',
  'telkari-kolye': 'taki',
  'zeytinyagi-sabun': 'dogal-urunler',
};

async function main() {
  const store = await prisma.store.findUnique({ where: { slug: MAGAZA_SLUG } });
  if (!store) { console.log(`⚠️ ${MAGAZA_SLUG} bulunamadi — mutabakat atlandi.`); return; }

  console.log(`=== KERVAN MUTABAKAT (${RAPOR ? 'RAPOR — yazma yok' : 'UYGULAMA'}) ===`);
  console.log(`Magaza: ${store.name} (${store.slug})\n`);

  const ust = await prisma.category.findUnique({
    where: { storeId_slug: { storeId: store.id, slug: UST_SLUG } },
  });
  if (!ust) { console.log(`⚠️ '${UST_SLUG}' kategorisi yok — once create-kervan.js.`); return; }

  // --- 1) Ust baslik ---
  const ustVeri = {};
  if (ust.name !== UST_AD) ustVeri.name = UST_AD;
  if (ust.parentId !== null) ustVeri.parentId = null;
  if (!ust.isActive) ustVeri.isActive = true;
  const ustKatalog = KATALOG.find((k) => k.slug === UST_SLUG);
  if (ustKatalog && ust.sortOrder !== ustKatalog.sira) ustVeri.sortOrder = ustKatalog.sira;

  console.log('--- 1) Ust baslik ---');
  if (Object.keys(ustVeri).length) {
    console.log(`  ${UST_SLUG}: ${ust.name} -> ${UST_AD}` +
      (ustVeri.sortOrder !== undefined ? ` (sira ${ustVeri.sortOrder})` : ''));
  } else console.log('  (degisiklik yok)');

  // --- 2) Alt kategoriler ---
  const altTanimlar = ustKatalog ? ustKatalog.alt : [];
  const altIsler = [];
  for (const a of altTanimlar) {
    const mevcut = await prisma.category.findUnique({
      where: { storeId_slug: { storeId: store.id, slug: a.slug } },
    });
    if (!mevcut) { altIsler.push({ tip: 'olustur', a }); continue; }
    const veri = {};
    if (mevcut.parentId !== ust.id) veri.parentId = ust.id;
    if (mevcut.name !== a.ad) veri.name = a.ad;
    if (mevcut.sortOrder !== a.sira) veri.sortOrder = a.sira;
    if (!mevcut.isActive) veri.isActive = true;
    if (Object.keys(veri).length) altIsler.push({ tip: 'guncelle', a, id: mevcut.id, veri });
  }
  console.log(`\n--- 2) Alt kategoriler: ${altIsler.length} islem ---`);
  for (const i of altIsler) console.log(`  ${i.tip.padEnd(9)} ${i.a.slug.padEnd(18)} ${i.a.ad}`);
  if (!altIsler.length) console.log('  (yapi zaten hedefte)');

  // --- 3) 12 urunun tasinmasi ---
  const altKatlar = await prisma.category.findMany({
    where: { storeId: store.id, slug: { in: Object.values(TASIMA) } },
  });
  const altIdBySlug = new Map(altKatlar.map((c) => [c.slug, c.id]));

  const tasimaIsler = [];
  const kdvNotlari = [];
  for (const [urunSlug, hedefAltSlug] of Object.entries(TASIMA)) {
    const u = await prisma.product.findUnique({
      where: { storeId_slug: { storeId: store.id, slug: urunSlug } },
    });
    if (!u) { console.log(`  ATLA (urun yok): ${urunSlug}`); continue; }
    const hedefId = altIdBySlug.get(hedefAltSlug);
    if (!hedefId) { console.log(`  ATLA (alt kategori yok): ${hedefAltSlug}`); continue; }

    if (u.categoryId !== hedefId) {
      tasimaIsler.push({ id: u.id, ad: u.name, slug: urunSlug, hedefAltSlug, hedefId });
    }
    // Bilgi: turetilen KDV vs kayitli KDV (otomatik duzeltme YOK)
    if (pricing) {
      const altAd = (altTanimlar.find((x) => x.slug === hedefAltSlug) || {}).ad || '';
      const t = pricing.kdvOraniBul(u.name, altAd);
      if (t.oran !== u.kdvOrani) kdvNotlari.push([u.name, u.kdvOrani, t.oran, altAd]);
    }
  }

  console.log(`\n--- 3) Urun tasima: ${tasimaIsler.length} ---`);
  for (const t of tasimaIsler) console.log(`  ${t.slug.padEnd(20)} -> ${t.hedefAltSlug.padEnd(18)} ${t.ad}`);
  if (!tasimaIsler.length) console.log('  (hepsi zaten yerinde)');

  if (kdvNotlari.length) {
    console.log(`\n--- BILGI: kayitli KDV ile turetilen KDV farkli (${kdvNotlari.length}) — DUZELTILMEZ ---`);
    for (const [ad, kayitli, turetilen, altAd] of kdvNotlari) {
      console.log(`  ${ad.padEnd(32)} kayitli %${kayitli}  turetilen %${turetilen}  [${altAd}]`);
    }
  }

  if (RAPOR) { console.log('\nRAPOR MODU — hicbir kayit degistirilmedi.'); return; }

  // --- Uygula ---
  let sayacUst = 0, sayacAlt = 0, sayacUrun = 0;
  if (Object.keys(ustVeri).length) {
    await prisma.category.update({ where: { id: ust.id }, data: ustVeri });
    sayacUst++;
  }
  for (const i of altIsler) {
    if (i.tip === 'olustur') {
      await prisma.category.create({
        data: {
          storeId: store.id, name: i.a.ad, slug: i.a.slug,
          parentId: ust.id, sortOrder: i.a.sira,
        },
      });
    } else {
      await prisma.category.update({ where: { id: i.id }, data: i.veri });
    }
    sayacAlt++;
  }
  for (const t of tasimaIsler) {
    await prisma.product.update({ where: { id: t.id }, data: { categoryId: t.hedefId } });
    sayacUrun++;
  }

  console.log(`\nKERVAN MUTABAKAT TAMAM — ust:${sayacUst}, alt:${sayacAlt}, tasinan urun:${sayacUrun}.`);
  console.log('Fiyat/desi/KDV/stok/isActive alanlarina dokunulmadi.');
  console.log('Bitti: Railway degiskeni KERVAN_MUTABAKAT silinebilir.');
}

main()
  .catch((e) => { console.error('Kervan mutabakat hata:', e); process.exit(0); })
  .finally(() => prisma.$disconnect());
