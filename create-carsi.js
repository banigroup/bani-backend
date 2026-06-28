// Bani Carsi magazasi + el emegi urunler — YENI FIYAT MOTORU ile.
// Her urun icin net fiyat + desi + KDV verilir; script vitrinFiyatHesapla ile
// vitrin fiyatini ve muhasebe kirilimini (komisyon/kargo/malKDV/hizmetKDV)
// hesaplayip yazar.
//
// IDEMPOTENT: tekrar calistirilabilir. Mevcut urunde fiyat/kirilimi gunceller
// ama isActive'e DOKUNMAZ (admin pasife alirsa restart'ta geri acilmaz).
//
// NOT: net fiyatlar ornektir — gercek net'leri URUNLER listesindeki net: degerinden duzelt.
// NOT: Satici paneli gelince bu script start'tan cikarilmali (panelden yapilan
//      fiyat duzenlemelerini ezmemesi icin).

const fs = require('fs');
const path = require('path');

// .env (lokal calismada okunur). Railway'de env zaten enjekte edilir; .env yoksa sorun degil.
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  env.split('\n').forEach((line) => {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* Railway'de .env yok — normal */ }

// Derlenmis fiyat motoru (nest build sonrasi dist'te olur). Iki olasi yol denenir.
let pricing;
try { pricing = require('./dist/delivery/pricing'); }
catch (e1) {
  try { pricing = require('./dist/src/delivery/pricing'); }
  catch (e2) { console.error('⚠️ Fiyat motoru (dist) bulunamadi — once nest build gerekli. Carsi seed atlandi.'); process.exit(0); }
}
const { vitrinFiyatHesapla } = pricing;

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// net: KURUS (KDV/komisyon/kargo HARIC). kdv: kategori orani (1/10/20).
const URUNLER = [
  // --- mevcut 4 (artik motordan gecirilip kirilimli yazilacak) ---
  { name: 'El Örgüsü Yün Çorap', slug: 'el-orgusu-corap', net: 12000n, desi: 1, kg: 0.2, kdv: 10 },
  { name: 'Bakır El İşi Cezve', slug: 'bakir-cezve', net: 35000n, desi: 4, kg: 1.5, kdv: 20 },
  { name: 'Kilim Desenli Yastık', slug: 'kilim-yastik', net: 28000n, desi: 8, kg: 1.2, kdv: 10 },
  { name: 'Doğal Zeytinyağı Sabunu', slug: 'zeytinyagi-sabun', net: 6000n, desi: 1, kg: 0.5, kdv: 20 },
  // --- yeni el emegi urunler (desi tablosunu tariyor) ---
  { name: 'El Dokuma Kilim', slug: 'el-dokuma-kilim', net: 180000n, desi: 25, kg: 6, kdv: 10 },
  { name: 'Bakır Tepsi', slug: 'bakir-tepsi', net: 45000n, desi: 6, kg: 2, kdv: 20 },
  { name: 'Keçe Terlik', slug: 'kece-terlik', net: 18000n, desi: 2, kg: 0.4, kdv: 10 },
  { name: 'El Yapımı Seramik Kâse', slug: 'seramik-kase', net: 22000n, desi: 5, kg: 1, kdv: 20 },
  { name: 'Gümüş Telkari Kolye', slug: 'telkari-kolye', net: 95000n, desi: 1, kg: 0.1, kdv: 20 },
  { name: 'Ahşap Oyma Servis Tabağı', slug: 'ahsap-tabak', net: 30000n, desi: 3, kg: 0.8, kdv: 20 },
  { name: 'El Örgüsü Yün Battaniye', slug: 'yun-battaniye', net: 65000n, desi: 14, kg: 3, kdv: 10 },
  { name: 'Bakır Güğüm', slug: 'bakir-gugum', net: 55000n, desi: 10, kg: 2.5, kdv: 20 },
];

const tl = (k) => (Number(k) / 100).toFixed(2);

async function main() {
  const owner = await prisma.user.findUnique({ where: { phone: '+905111111111' } });
  if (!owner) { console.error('⚠️ Satici bulunamadi (+905111111111). Once ana seed. Carsi seed atlandi.'); process.exit(0); }

  let store = await prisma.store.findUnique({ where: { slug: 'demo-carsi' } });
  if (!store) {
    store = await prisma.store.create({
      data: {
        ownerId: owner.id, name: 'Bani Carsi', slug: 'demo-carsi',
        type: 'SHOP', businessUnit: 'CARSI',
        description: 'Anadolu ureticisinden el emegi urunler',
        isActive: true, commissionRate: 1000,
      },
    });
    console.log('demo-carsi OLUSTURULDU:', store.id);
  }

  let cat = await prisma.category.findFirst({ where: { storeId: store.id, slug: 'el-emegi' } });
  if (!cat) cat = await prisma.category.create({ data: { storeId: store.id, name: 'El Emegi', slug: 'el-emegi' } });

  let eklenen = 0, guncellenen = 0;
  for (const u of URUNLER) {
    const h = vitrinFiyatHesapla(u.net, u.desi, u.kg, 'A', u.kdv);
    if (!h.ok) { console.log('  ATLA:', u.name, '-', h.sebep); continue; }

    const fiyatData = {
      price: h.vitrinKurus,
      netFiyat: u.net,
      kdvOrani: u.kdv,
      komisyonTutari: h.komisyonKurus,
      kargoTutari: h.kargoKurus + h.yuvarlamaKurus, // yuvarlama farki kargoya
      malKdvTutari: h.malKdvKurus,
      hizmetKdvTutari: h.hizmetKdvKurus,
      desi: u.desi,
      weightKg: u.kg,
      satisModeli: 'A',
    };

    const exists = await prisma.product.findFirst({ where: { storeId: store.id, slug: u.slug } });
    if (exists) {
      await prisma.product.update({ where: { id: exists.id }, data: fiyatData }); // isActive'e dokunmaz
      guncellenen++;
      console.log(`  ↻ ${u.name}  vitrin=${tl(h.vitrinKurus)}  [KDV %${u.kdv}, desi ${u.desi}, kargo ${tl(fiyatData.kargoTutari)}]`);
    } else {
      await prisma.product.create({
        data: { storeId: store.id, categoryId: cat.id, name: u.name, slug: u.slug, stock: 100, unit: 'adet', isActive: true, ...fiyatData },
      });
      eklenen++;
      console.log(`  + ${u.name}  vitrin=${tl(h.vitrinKurus)}  [KDV %${u.kdv}, desi ${u.desi}, kargo ${tl(fiyatData.kargoTutari)}]`);
    }
  }
  console.log(`CARSI SEED TAMAM — ${eklenen} eklendi, ${guncellenen} guncellendi.`);
}

main()
  .catch((e) => { console.error('Carsi seed hata:', e); process.exit(0); })
  .finally(() => prisma.$disconnect());
