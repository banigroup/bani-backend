// Test/doğrulama script'i — fiyat motorunu gerçek DB'de uçtan uca sınar.
//
// NE YAPAR:
//   1) Mevcut ürünleri listeler + desi var/yok raporu (4 ürün kontrolü).
//   2) 10 çeşitli "TEST-" ürünü ekler: desi tablosunun her bölgesi +
//      her KDV kategorisi. KDV'yi isimden OTOMATİK tanır (kdvOraniBul).
//      Her ürün için tam muhasebe kırılımını yazdırır.
//
// TEMİZLİK:
//   --temizle  ->  tüm "TEST-" ürünlerini siler.
//
// ÇALIŞTIRMA:
//   npx ts-node prisma/test-urun-ekle.ts
//   npx ts-node prisma/test-urun-ekle.ts --temizle

import { PrismaClient } from '@prisma/client';
import { vitrinFiyatHesapla, kdvOraniBul } from '../src/delivery/pricing';

const prisma = new PrismaClient();
const TEMIZLE = process.argv.includes('--temizle');
const PREFIX = 'TEST-';

const tl = (k: bigint) => (Number(k) / 100).toFixed(2).padStart(10);
const slug = (s: string) =>
  s.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// net: KURUŞ. desi tablosunun farklı bölgelerini ve KDV kategorilerini tarar.
const TEST_URUNLER = [
  { ad: 'Domates (taze sebze)', net: 5000, desi: 1 },     // gıda %1
  { ad: 'Beyaz peynir', net: 18000, desi: 5 },    // gıda %1
  { ad: 'Cips paketi atistirmalik', net: 4000, desi: 3 }, // işlenmiş %10
  { ad: 'Pamuklu tisort', net: 35000, desi: 2 },    // tekstil %10
  { ad: 'Ahsap sandalye', net: 120000, desi: 14 },  // mobilya %10
  { ad: 'Uclu koltuk', net: 800000, desi: 46 },  // mobilya %10
  { ad: 'Parfum', net: 95000, desi: 1 },    // kozmetik %20
  { ad: 'Akilli telefon', net: 2500000, desi: 2 },  // elektronik %20
  { ad: 'Buzdolabi (beyaz esya)', net: 3500000, desi: 60 }, // elektronik %20, 50 ÜSTÜ
  { ad: 'Tencere seti (mutfak gerec)', net: 150000, desi: 25 }, // ev gereçleri %20
];

async function main() {
  if (TEMIZLE) {
    const r = await prisma.product.deleteMany({ where: { name: { startsWith: PREFIX } } });
    console.log(`\n🧹 ${r.count} adet TEST- ürünü silindi.\n`);
    return;
  }

  // 1) Mevcut ürünler — desi kontrolü
  const mevcut = await prisma.product.findMany({
    where: { deletedAt: null, name: { not: { startsWith: PREFIX } } },
    include: { store: { select: { name: true, businessUnit: true } } },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\n=== MEVCUT ÜRÜNLER (${mevcut.length}) — desi kontrolü ===`);
  if (mevcut.length === 0) console.log('  (hiç ürün yok)');
  for (const p of mevcut) {
    const isaret = p.desi > 0 ? '✓ desi var' : '⚠️  desi YOK';
    console.log(
      `  [${p.store.businessUnit}/${p.store.name}] ${p.name} — desi=${p.desi} kg=${p.weightKg} net=${tl(p.netFiyat)} price=${tl(p.price)}  ${isaret}`,
    );
  }

  // Test ürünleri için hedef mağaza: ilk mevcut ürünün mağazası
  const hedefStoreId = mevcut[0]?.storeId;
  if (!hedefStoreId) {
    console.log('\n⚠️  Hiç mağaza bulunamadı — test ürünü eklenemiyor. Önce bir mağaza gerekli.\n');
    return;
  }

  // 2) 10 test ürünü ekle + kırılımı yazdır
  console.log(`\n=== 10 TEST ÜRÜNÜ EKLENİYOR (mağaza: ${mevcut[0].store.name}) ===\n`);
  for (const t of TEST_URUNLER) {
    const kdvBilgi = kdvOraniBul(t.ad); // isimden OTOMATİK KDV
    const h = vitrinFiyatHesapla(BigInt(t.net), t.desi, 0, 'A', kdvBilgi.oran);
    if (!h.ok) {
      console.log(`  ⚠️  ${t.ad}: ${h.sebep}`);
      continue;
    }
    const yeniKargo = h.kargoKurus + h.yuvarlamaKurus;
    await prisma.product.create({
      data: {
        storeId: hedefStoreId,
        name: PREFIX + t.ad,
        slug: PREFIX.toLowerCase() + slug(t.ad) + '-' + Math.random().toString(36).slice(2, 7),
        price: h.vitrinKurus,
        netFiyat: BigInt(t.net),
        kdvOrani: kdvBilgi.oran,
        komisyonTutari: h.komisyonKurus,
        kargoTutari: yeniKargo,
        malKdvTutari: h.malKdvKurus,
        hizmetKdvTutari: h.hizmetKdvKurus,
        desi: t.desi,
        weightKg: 0,
        satisModeli: 'A',
        isActive: false, // onay bekliyor (gerçek akış gibi)
      },
    });
    console.log(
      `  ✓ ${t.ad}  [KDV %${kdvBilgi.oran} — ${kdvBilgi.etiket}${kdvBilgi.otomatik ? '' : ' ⚠️'}], desi ${t.desi}\n` +
      `      net=${tl(BigInt(t.net))} kom=${tl(h.komisyonKurus)} kargo=${tl(yeniKargo)} malKDV=${tl(h.malKdvKurus)} hizKDV=${tl(h.hizmetKdvKurus)}  =>  VİTRİN=${tl(h.vitrinKurus)}`,
    );
  }

  console.log(`\n✅ Bitti. Silmek için:  npx ts-node prisma/test-urun-ekle.ts --temizle\n`);
}

main()
  .catch((e) => {
    console.error('HATA:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
