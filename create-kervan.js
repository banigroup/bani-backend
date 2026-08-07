// Kervan (demo-carsi) genel e-ticaret katalog seed'i — SAF KATKI.
// Her deploy'da calisir (Dockerfile CMD).
//
// KURAL: mevcut satira ASLA dokunmaz. Sadece eksik kategori/urun kartini acar.
//   - Panelden yapilan ad/fiyat/stok duzenlemeleri korunur. FIYAT EZMEZ.
//     (Emekliye ayrilan create-carsi.js her deploy'da fiyat yeniden yaziyordu.)
//   - Mevcut 12 yoresel urunun kategorilere tasinmasi mutabakat-kervan.js isidir.
//
// KDV: elle DEGIL, motordan turetilir -> kdvOraniBul(urunAdi, YAPRAK kategori adi).
//      Panel (kdvOraniBelirle) ile birebir ayni davranis. Ust kategori adi
//      BILEREK verilmez: "Kitap, Muzik, Film, Hobi" ustu 'kitap' kelimesi
//      tasidigi icin Hobi urunlerini yanlislikla %0 istisnaya dusuruyordu.
//
// FIYAT: vitrinFiyatHesapla ile kurulur; komisyon orani MAGAZADAN okunur
//        (sabit %8 varsayilmaz — store.commissionRate binde cinsinden).
//
// IDEMPOTENT: iki kez calisirsa cift kayit uretmez. Anahtar (storeId, slug).
// Magazayi YARATMAZ: demo-carsi yoksa sessizce cikar.

const { KATALOG, MAGAZA_SLUG, envYukle } = require('./kervan-katalog');

envYukle(__dirname);

// Derlenmis fiyat motoru (nest build sonrasi dist'te olur).
let pricing;
try { pricing = require('./dist/src/delivery/pricing'); }
catch (e1) {
  try { pricing = require('./dist/delivery/pricing'); }
  catch (e2) { console.log('⚠️ Fiyat motoru (dist) bulunamadi — once build. Kervan seed atlandi.'); process.exit(0); }
}
const { vitrinFiyatHesapla, kdvOraniBul } = pricing;

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const tl = (k) => (Number(k) / 100).toFixed(2);

async function kategoriBul(storeId, slug) {
  return prisma.category.findUnique({ where: { storeId_slug: { storeId, slug } } });
}

async function main() {
  const store = await prisma.store.findUnique({ where: { slug: MAGAZA_SLUG } });
  if (!store) {
    console.log(`⚠️ ${MAGAZA_SLUG} bulunamadi — once ana seed. Kervan katalog atlandi.`);
    return;
  }

  // Komisyon: binde -> yuzde (800 -> 8n). Magazadan okunur, sabit varsayilmaz.
  const komisyonOran = BigInt(store.commissionRate ?? 800) / 100n;

  let yeniUst = 0, yeniAlt = 0, eklenen = 0, dokunulmayan = 0, atlanan = 0;

  for (const ust of KATALOG) {
    let ustKat = await kategoriBul(store.id, ust.slug);
    if (!ustKat) {
      ustKat = await prisma.category.create({
        data: { storeId: store.id, name: ust.ad, slug: ust.slug, sortOrder: ust.sira },
      });
      yeniUst++;
    }

    for (const alt of ust.alt) {
      let altKat = await kategoriBul(store.id, alt.slug);
      if (!altKat) {
        altKat = await prisma.category.create({
          data: {
            storeId: store.id, name: alt.ad, slug: alt.slug,
            parentId: ustKat.id, sortOrder: alt.sira,
          },
        });
        yeniAlt++;
      }

      for (const [ad, slug, netKurus, desi, kg, model] of alt.urunler) {
        const mevcut = await prisma.product.findUnique({
          where: { storeId_slug: { storeId: store.id, slug } },
        });
        if (mevcut) { dokunulmayan++; continue; }

        // KDV: YAPRAK kategori adi ile turetilir
        const kdv = kdvOraniBul(ad, alt.ad);
        const h = vitrinFiyatHesapla(netKurus, desi, kg, model, kdv.oran, komisyonOran);
        if (!h.ok) { console.log(`  ATLA: ${ad} — ${h.sebep}`); atlanan++; continue; }

        await prisma.product.create({
          data: {
            storeId: store.id, categoryId: altKat.id,
            name: ad, slug,
            price: h.vitrinKurus,
            netFiyat: netKurus,
            kdvOrani: kdv.oran,
            komisyonTutari: h.komisyonKurus,
            kargoTutari: h.kargoKurus + h.yuvarlamaKurus, // yuvarlama farki kargoya
            malKdvTutari: h.malKdvKurus,
            hizmetKdvTutari: h.hizmetKdvKurus,
            desi, weightKg: kg, satisModeli: model,
            stock: 100, unit: 'adet', isActive: true,
          },
        });
        eklenen++;
        if (!kdv.otomatik) {
          console.log(`  ! KDV varsayilan %${kdv.oran} (otomatik taninamadi): ${ad} [${alt.ad}]`);
        }
      }
    }
  }

  console.log(
    `KERVAN KATALOG — ${eklenen} urun eklendi, ${dokunulmayan} mevcut satira dokunulmadi, ` +
    `${yeniUst} ust + ${yeniAlt} alt kategori acildi` + (atlanan ? `, ${atlanan} atlandi` : '') + '.',
  );
  console.log(`  komisyon orani: %${komisyonOran} (magazadan: binde ${store.commissionRate})`);
}

main()
  .catch((e) => { console.error('Kervan katalog hata:', e); process.exit(0); })
  .finally(() => prisma.$disconnect());
