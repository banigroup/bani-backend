// Kervan mutabakati — TEK SEFERLIK, elle tetiklenir. IKI IS TEK TURDA:
//   A) Yoresel hiyerarsi: el-emegi -> "Yöresel & El Sanatları", 5 alt kategori,
//      mevcut 12 urunun alt kategorilere tasinmasi.
//   B) KDV/fiyat duzeltmesi: kurali yanlis uygulanmis satirlarin kdvOrani +
//      muhasebe kirilimi + vitrin price'inin DUZELTILMIS kuraldan yeniden
//      turetilmesi. (Canliya cikan hata: 'aksesuar'/'canta'/'kahve' genel
//      anahtarlari %10 kurallarinda oldugu ve %20 kurallarindan once geldigi
//      icin 14 urun eksik oranla yazilmisti.)
//
// TETIK: KERVAN_MUTABAKAT
//   (yok)   -> hicbir sey yapmaz. Normal deploy'larda olu koddur.
//   =rapor  -> HICBIR SEY YAZMAZ, yapilacaklari listeler.
//   =1      -> uygular.
//
// KDV DUZELTME KAPSAMI — bilerek DAR:
//   Yalnizca kayitli kdvOrani, motorun turettigi orandan FARKLI olan satirlar
//   duzeltilir. Orani zaten dogru olan satira DOKUNULMAZ — fiyati elle
//   duzenlenmis olabilir, korunur. Bu, "saf katki / fiyat ezme" ilkesinin
//   mutabakat turundaki karsiligidir.
//
//   Duzeltilen satirda TUM kirilim tutarli yazilir (yalnizca kdvOrani+malKdv
//   degil): price = net + komisyon + kargo + malKdv + hizmetKdv olmali ve
//   kargoTutari tam-liraya yuvarlama farkini tasiyor; oran degisince yuvarlama
//   da degisir. Eksik yazim bu esitligi bozardi.
//
//   KDV, urunun TASINMA SONRASI yaprak kategorisi ile turetilir (once tasima).
//
// DOKUNULMAYANLAR: netFiyat, desi, weightKg, satisModeli, stock, isActive, slug.
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
catch (e1) {
  try { pricing = require('./dist/delivery/pricing'); }
  catch (e2) { console.log('⚠️ Fiyat motoru (dist) bulunamadi — once build. Mutabakat atlandi.'); process.exit(0); }
}
const { kdvOraniBul, vitrinFiyatHesapla } = pricing;

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UST_SLUG = 'el-emegi';
const UST_AD = 'Yöresel & El Sanatları';
const tl = (k) => (Number(k) / 100).toFixed(2) + ' TL';

// Mevcut 12 urunun hedef alt kategorisi (kullanici onayli dagilim)
const TASIMA = {
  'bakir-gugum': 'bakir-metal', 'bakir-tepsi': 'bakir-metal', 'bakir-cezve': 'bakir-metal',
  'el-dokuma-kilim': 'tekstil-dokuma', 'yun-battaniye': 'tekstil-dokuma',
  'el-orgusu-corap': 'tekstil-dokuma', 'kilim-yastik': 'tekstil-dokuma',
  'kece-terlik': 'tekstil-dokuma',
  'seramik-kase': 'seramik-ahsap', 'ahsap-tabak': 'seramik-ahsap',
  'telkari-kolye': 'taki',
  'zeytinyagi-sabun': 'dogal-urunler',
};

async function main() {
  const store = await prisma.store.findUnique({ where: { slug: MAGAZA_SLUG } });
  if (!store) { console.log(`⚠️ ${MAGAZA_SLUG} bulunamadi — mutabakat atlandi.`); return; }

  const komisyonOran = BigInt(store.commissionRate ?? 800) / 100n;

  console.log(`=== KERVAN MUTABAKAT (${RAPOR ? 'RAPOR — yazma yok' : 'UYGULAMA'}) ===`);
  console.log(`Magaza: ${store.name} (${store.slug}) — komisyon %${komisyonOran}\n`);

  const ust = await prisma.category.findUnique({
    where: { storeId_slug: { storeId: store.id, slug: UST_SLUG } },
  });
  if (!ust) { console.log(`⚠️ '${UST_SLUG}' kategorisi yok — once create-kervan.js.`); return; }

  const ustKatalog = KATALOG.find((k) => k.slug === UST_SLUG);
  const altTanimlar = ustKatalog ? ustKatalog.alt : [];

  // ---------- A1) Ust baslik ----------
  const ustVeri = {};
  if (ust.name !== UST_AD) ustVeri.name = UST_AD;
  if (ust.parentId !== null) ustVeri.parentId = null;
  if (!ust.isActive) ustVeri.isActive = true;
  if (ustKatalog && ust.sortOrder !== ustKatalog.sira) ustVeri.sortOrder = ustKatalog.sira;

  console.log('--- A1) Ust baslik ---');
  console.log(Object.keys(ustVeri).length
    ? `  ${UST_SLUG}: "${ust.name}" -> "${UST_AD}"` + (ustVeri.sortOrder !== undefined ? ` (sira ${ustVeri.sortOrder})` : '')
    : '  (degisiklik yok)');

  // ---------- A2) Alt kategoriler ----------
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
  console.log(`\n--- A2) Alt kategoriler: ${altIsler.length} islem ---`);
  for (const i of altIsler) console.log(`  ${i.tip.padEnd(9)} ${i.a.slug.padEnd(18)} ${i.a.ad}`);
  if (!altIsler.length) console.log('  (yapi zaten hedefte)');

  // ---------- A3) 12 urunun tasinmasi ----------
  const tumKategoriler = await prisma.category.findMany({ where: { storeId: store.id } });
  const katById = new Map(tumKategoriler.map((c) => [c.id, c]));
  const katBySlug = new Map(tumKategoriler.map((c) => [c.slug, c]));

  // Tasima SLUG uzerinden planlanir — hedef kategori henuz YARATILMAMIS olabilir
  // (A2'de olusturulacak). Id'ler uygulama aninda, kategoriler kurulduktan
  // SONRA cozulur; aksi halde ilk kosuda hicbir urun tasinmazdi.
  const tasimaIsler = [];
  for (const [urunSlug, hedefAltSlug] of Object.entries(TASIMA)) {
    const u = await prisma.product.findUnique({
      where: { storeId_slug: { storeId: store.id, slug: urunSlug } },
    });
    if (!u) { console.log(`  ATLA (urun yok): ${urunSlug}`); continue; }
    const mevcutSlug = (katById.get(u.categoryId) || {}).slug;
    if (mevcutSlug !== hedefAltSlug) {
      tasimaIsler.push({ id: u.id, ad: u.name, slug: urunSlug, hedefSlug: hedefAltSlug });
    }
  }
  console.log(`\n--- A3) Urun tasima: ${tasimaIsler.length} ---`);
  for (const t of tasimaIsler) console.log(`  ${t.slug.padEnd(20)} -> ${t.hedefSlug.padEnd(18)} ${t.ad}`);
  if (!tasimaIsler.length) console.log('  (hepsi zaten yerinde)');

  // ---------- B) KDV / fiyat duzeltmesi ----------
  // Tasima SONRASI yaprak kategori adiyla turetilir.
  // Hedef yaprak adlari KATALOG tanimindan gelir — DB'de kategori henuz
  // olmasa bile dogru ad kullanilir (rapor ile uygulama ayni sonucu verir).
  const hedefAdBySlug = new Map(altTanimlar.map((a) => [a.slug, a.ad]));
  const hedefKatAdi = new Map(); // productId -> tasima sonrasi yaprak kategori adi
  for (const [urunSlug, hedefAltSlug] of Object.entries(TASIMA)) {
    const u = await prisma.product.findUnique({
      where: { storeId_slug: { storeId: store.id, slug: urunSlug } },
    });
    if (u && hedefAdBySlug.has(hedefAltSlug)) hedefKatAdi.set(u.id, hedefAdBySlug.get(hedefAltSlug));
  }

  const urunler = await prisma.product.findMany({
    where: { storeId: store.id, deletedAt: null },
    orderBy: { name: 'asc' },
  });

  const kdvIsler = [];
  const netsiz = [];
  for (const u of urunler) {
    const katAd = hedefKatAdi.get(u.id) || (katById.get(u.categoryId) || {}).name || '';
    const dogruKdv = kdvOraniBul(u.name, katAd).oran;
    if (dogruKdv === u.kdvOrani) continue; // orani dogru -> DOKUNMA

    if (!u.netFiyat || u.netFiyat <= 0n) { netsiz.push(`${u.name} (net yok)`); continue; }

    const h = vitrinFiyatHesapla(u.netFiyat, u.desi, u.weightKg, u.satisModeli || 'A', dogruKdv, komisyonOran);
    if (!h.ok) { netsiz.push(`${u.name} (${h.sebep})`); continue; }

    kdvIsler.push({
      id: u.id, ad: u.name, katAd,
      eskiKdv: u.kdvOrani, yeniKdv: dogruKdv,
      eskiFiyat: u.price, yeniFiyat: h.vitrinKurus,
      veri: {
        kdvOrani: dogruKdv,
        price: h.vitrinKurus,
        komisyonTutari: h.komisyonKurus,
        kargoTutari: h.kargoKurus + h.yuvarlamaKurus,
        malKdvTutari: h.malKdvKurus,
        hizmetKdvTutari: h.hizmetKdvKurus,
      },
    });
  }

  console.log(`\n--- B) KDV/fiyat duzeltmesi: ${kdvIsler.length} urun ---`);
  if (kdvIsler.length) {
    console.log('  ' + 'urun'.padEnd(36) + 'kategori'.padEnd(22) + 'KDV'.padEnd(12) + 'vitrin fiyat');
    for (const k of kdvIsler) {
      console.log('  ' + k.ad.padEnd(36) + k.katAd.padEnd(22) +
        `%${k.eskiKdv} -> %${k.yeniKdv}`.padEnd(12) +
        `${tl(k.eskiFiyat)} -> ${tl(k.yeniFiyat)}`);
    }
  } else console.log('  (tum oranlar dogru)');
  if (netsiz.length) {
    console.log(`  ! yeniden hesaplanamayan ${netsiz.length}: ${netsiz.join(', ')}`);
  }

  if (RAPOR) {
    console.log('\nRAPOR MODU — hicbir kayit degistirilmedi.');
    console.log(`Ozet: ust ${Object.keys(ustVeri).length ? 1 : 0}, alt ${altIsler.length}, tasima ${tasimaIsler.length}, kdv ${kdvIsler.length}`);
    return;
  }

  // ---------- UYGULA ----------
  let sUst = 0, sAlt = 0, sTasima = 0, sKdv = 0;

  if (Object.keys(ustVeri).length) {
    await prisma.category.update({ where: { id: ust.id }, data: ustVeri });
    sUst++;
  }
  for (const i of altIsler) {
    if (i.tip === 'olustur') {
      await prisma.category.create({
        data: { storeId: store.id, name: i.a.ad, slug: i.a.slug, parentId: ust.id, sortOrder: i.a.sira },
      });
    } else {
      await prisma.category.update({ where: { id: i.id }, data: i.veri });
    }
    sAlt++;
  }
  // Kategoriler kuruldu; hedef id'ler SIMDI cozulur (yukarida slug ile planlandi).
  const katYeni = await prisma.category.findMany({ where: { storeId: store.id } });
  const idBySlug = new Map(katYeni.map((c) => [c.slug, c.id]));

  // Tasima ONCE, KDV SONRA: oran yaprak kategoriden turetiliyor.
  for (const t of tasimaIsler) {
    const hedefId = idBySlug.get(t.hedefSlug);
    if (!hedefId) { console.log(`  ATLA (alt kategori olusmadi): ${t.hedefSlug}`); continue; }
    await prisma.product.update({ where: { id: t.id }, data: { categoryId: hedefId } });
    sTasima++;
  }
  for (const k of kdvIsler) {
    await prisma.product.update({ where: { id: k.id }, data: k.veri });
    sKdv++;
  }

  console.log(`\nKERVAN MUTABAKAT TAMAM — ust:${sUst}, alt:${sAlt}, tasinan:${sTasima}, KDV duzeltilen:${sKdv}.`);
  console.log('netFiyat / desi / kg / satisModeli / stock / isActive alanlarina dokunulmadi.');
  console.log('Bitti: Railway degiskeni KERVAN_MUTABAKAT silinebilir.');
}

main()
  .catch((e) => { console.error('Kervan mutabakat hata:', e); process.exit(0); })
  .finally(() => prisma.$disconnect());
