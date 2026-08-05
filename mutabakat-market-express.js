// Express rafi mutabakati — TEK SEFERLIK, elle tetiklenir.
//
// TETIK: MARKET_MUTABAKAT ortam degiskeni.
//   (yok)   -> hicbir sey yapmaz, aninda cikar. Normal deploy'larda olu koddur.
//   =rapor  -> HICBIR SEY YAZMAZ. Canli DB'deki gercek tabloyu listeler.
//   =1      -> uygular.
//
// UYGULAMA (=1):
//   1) Katalogda olan urunlerin ad/fiyat/kategorisi katalog degerine cekilir.
//   2) Katalog-disi urunler deletedAt ile emekliye ayrilir (yumusak silme).
//      Kalici silme YAPILMAZ: CartItem'in gercek FK'si var, birinin sepetindeki
//      urun silinemez. deletedAt geri alinabilir (null yapmak yeter).
//   3) Canli urunu kalmayan kategoriler isActive=false yapilir; urunu olan
//      pasif kategori yeniden aktiflestirilir (kendini duzelten).
//   isActive ve stock alanlarina (urun tarafinda) DOKUNULMAZ.
//
// IDEMPOTENT: ikinci calistirmada her sayac 0 doner.

const { MAGAZA_SLUG, envYukle, katalogHaritasi, KATALOG } = require('./market-express-katalog');

const MOD = process.env.MARKET_MUTABAKAT;
if (!MOD) {
  console.log('MUTABAKAT: MARKET_MUTABAKAT tanimli degil — atlandi.');
  process.exit(0);
}
const RAPOR = MOD === 'rapor';

envYukle(__dirname);

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const tl = (k) => (Number(k) / 100).toFixed(2) + ' TL';

async function main() {
  const store = await prisma.store.findUnique({ where: { slug: MAGAZA_SLUG } });
  if (!store) {
    console.log(`⚠️ ${MAGAZA_SLUG} bulunamadi — mutabakat atlandi.`);
    return;
  }

  const harita = katalogHaritasi();
  const kategoriler = await prisma.category.findMany({ where: { storeId: store.id } });
  const katIdBySlug = new Map(kategoriler.map((c) => [c.slug, c.id]));

  // Yalnizca henuz emekliye ayrilmamis urunler
  const urunler = await prisma.product.findMany({
    where: { storeId: store.id, deletedAt: null },
    orderBy: { name: 'asc' },
  });

  console.log(`=== MUTABAKAT (${RAPOR ? 'RAPOR — yazma yok' : 'UYGULAMA'}) ===`);
  console.log(`Magaza: ${store.name} (${store.slug}) — canli urun: ${urunler.length}, kategori: ${kategoriler.length}`);

  const hizalanacak = [];
  const emekli = [];

  for (const u of urunler) {
    const k = harita.get(u.slug);
    if (!k) { emekli.push(u); continue; }
    const hedefKatId = katIdBySlug.get(k.katSlug) ?? null;
    const farkli = u.name !== k.ad || u.price !== k.kurus || (hedefKatId && u.categoryId !== hedefKatId);
    if (farkli) hizalanacak.push({ u, k, hedefKatId });
  }

  console.log(`\n--- Katalogla eslesip guncellenecek: ${hizalanacak.length} ---`);
  for (const { u, k } of hizalanacak) {
    const fiyatNotu = u.price !== k.kurus ? `${tl(u.price)} -> ${tl(k.kurus)}` : 'fiyat ayni';
    console.log(`  ${u.slug.padEnd(38)} ${fiyatNotu}`);
  }

  console.log(`\n--- Katalog-disi, emekliye ayrilacak: ${emekli.length} ---`);
  for (const u of emekli) console.log(`  ${u.slug.padEnd(38)} ${u.name} (${tl(u.price)})`);

  if (RAPOR) {
    console.log('\nRAPOR MODU — hicbir kayit degistirilmedi.');
    return;
  }

  let guncellenen = 0, emekliEdilen = 0;

  for (const { u, k, hedefKatId } of hizalanacak) {
    await prisma.product.update({
      where: { id: u.id },
      data: { name: k.ad, price: k.kurus, ...(hedefKatId ? { categoryId: hedefKatId } : {}) },
    });
    guncellenen++;
  }

  for (const u of emekli) {
    await prisma.product.update({ where: { id: u.id }, data: { deletedAt: new Date() } });
    emekliEdilen++;
  }

  // Bos kalan kategorileri gizle / dolan kategoriyi geri ac
  const katalogSluglari = new Set(KATALOG.map((k) => k.slug));
  let gizlenen = 0, geriAcilan = 0;

  for (const c of kategoriler) {
    const canliAdet = await prisma.product.count({
      where: { storeId: store.id, categoryId: c.id, deletedAt: null },
    });
    if (canliAdet === 0 && c.isActive) {
      await prisma.category.update({ where: { id: c.id }, data: { isActive: false } });
      gizlenen++;
      console.log(`  kategori gizlendi: ${c.slug} (${c.name})`);
    } else if (canliAdet > 0 && !c.isActive && katalogSluglari.has(c.slug)) {
      await prisma.category.update({ where: { id: c.id }, data: { isActive: true } });
      geriAcilan++;
      console.log(`  kategori geri acildi: ${c.slug} (${c.name})`);
    }
  }

  console.log(`\nMUTABAKAT TAMAM — ${guncellenen} urun hizalandi, ${emekliEdilen} urun emekliye ayrildi, ${gizlenen} kategori gizlendi, ${geriAcilan} kategori geri acildi.`);
  console.log('Bitti: Railway degiskeni MARKET_MUTABAKAT silinebilir.');
}

main()
  .catch((e) => { console.error('Mutabakat hata:', e); process.exit(0); })
  .finally(() => prisma.$disconnect());
