// BaniMarket Express (demo-market) katalog seed'i — SAF KATKI.
// Her deploy'da calisir (Dockerfile CMD).
//
// KURAL: mevcut satira ASLA dokunmaz. Sadece eksik kategori/urun kartini acar.
//   - Panelden yapilan ad/fiyat/stok duzenlemeleri korunur.
//   - Fiyat ezme YOK. Katalog fiyatlarini mevcut satirlara uygulamak
//     tek seferlik istir; onu mutabakat-market-express.js yapar.
//
// IDEMPOTENT: iki kez calisirsa cift kayit uretmez. Anahtar (storeId, slug).
// Magazayi YARATMAZ: demo-market yoksa sessizce cikar (ana seed'in isi).

const { KATALOG, MAGAZA_SLUG, envYukle } = require('./market-express-katalog');

envYukle(__dirname);

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const store = await prisma.store.findUnique({ where: { slug: MAGAZA_SLUG } });
  if (!store) {
    console.log(`⚠️ ${MAGAZA_SLUG} bulunamadi — once ana seed. Express katalog atlandi.`);
    return;
  }

  let eklenen = 0, dokunulmayan = 0, yeniKategori = 0;

  for (const k of KATALOG) {
    const varMi = await prisma.category.findUnique({
      where: { storeId_slug: { storeId: store.id, slug: k.slug } },
    });
    const kategori = varMi ?? await prisma.category.create({
      data: { storeId: store.id, name: k.name, slug: k.slug, sortOrder: k.sira },
    });
    if (!varMi) yeniKategori++;

    for (const [ad, slug, kurus] of k.urunler) {
      const mevcut = await prisma.product.findUnique({
        where: { storeId_slug: { storeId: store.id, slug } },
      });
      if (mevcut) { dokunulmayan++; continue; }

      await prisma.product.create({
        data: {
          storeId: store.id, categoryId: kategori.id,
          name: ad, slug, price: kurus,
          stock: 100, unit: 'adet', isActive: true,
        },
      });
      eklenen++;
    }
  }

  console.log(`EXPRESS KATALOG — ${eklenen} urun eklendi, ${dokunulmayan} mevcut satira dokunulmadi, ${yeniKategori} yeni kategori.`);
}

main()
  .catch((e) => { console.error('Express katalog hata:', e); process.exit(0); })
  .finally(() => prisma.$disconnect());
