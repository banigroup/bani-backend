// Bani Coffee backend mağazası + ürünler (TEK SEFERLİK, tekrar çalıştırılabilir).
// Çalıştır:  cd "$HOME\Desktop\bani-backend"; node create-coffee.js
const fs = require('fs');
const path = require('path');
// .env'i bağımsız oku (dotenv gerektirmez)
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  env.split('\n').forEach((line) => {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { console.warn('.env okunamadı, mevcut ortam değişkenleri kullanılacak'); }

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Fiyatlar kuruş cinsinden BigInt (örn. 4500n = 45,00 ₺). Dilediğin gibi düzenle.
const COFFEES = [
  { name: 'HASANKEYF — Espresso', slug: 'kahve-hasankeyf-espresso', price: 4500n },
  { name: 'HARPUT — Double Espresso', slug: 'kahve-harput-double-espresso', price: 5500n },
  { name: 'DARA — Americano', slug: 'kahve-dara-americano', price: 5500n },
  { name: 'HARRAN — Türk Kahvesi Special', slug: 'kahve-harran-turk-special', price: 5000n },
  { name: 'CİLO — Cold Brew', slug: 'kahve-cilo-cold-brew', price: 7000n },
  { name: 'SUR — House Blend', slug: 'kahve-sur-house-blend', price: 6000n },
  { name: 'KAYISI — Apricot Latte', slug: 'kahve-kayisi-apricot-latte', price: 7500n },
  { name: 'NEMRUT — Flat White Premium', slug: 'kahve-nemrut-flat-white', price: 7000n },
  { name: 'BEŞMİNARE — Cappuccino', slug: 'kahve-besminare-cappuccino', price: 6500n },
  { name: 'MURAT — Iced Americano', slug: 'kahve-murat-iced-americano', price: 6000n },
  { name: 'PALANDÖKEN — White Mocha', slug: 'kahve-palandoken-white-mocha', price: 7500n },
  { name: 'İSHAKPAŞA — Caramel Macchiato', slug: 'kahve-ishakpasa-caramel-macc', price: 7500n },
  { name: 'PERİ — Vanilla Latte', slug: 'kahve-peri-vanilla-latte', price: 7000n },
  { name: 'MEVLA — Sütlü Türk Kahvesi', slug: 'kahve-mevla-sutlu-turk', price: 5500n },
  { name: 'ERCİYES — Reserve Blend', slug: 'kahve-erciyes-reserve-blend', price: 8000n },
];

const DESSERTS = [
  { name: 'ZERZEVAN — Tarçınlı Cevizli Kek', slug: 'tatli-zerzevan-tarcinli-kek', price: 5500n },
  { name: 'SİMAK — Sade Kruvasan', slug: 'tatli-simak-sade-kruvasan', price: 4500n },
  { name: 'MİRAS — Islak Kurabiye', slug: 'tatli-miras-islak-kurabiye', price: 4000n },
  { name: 'BERCESTE — Cevizli Brownie', slug: 'tatli-berceste-cevizli-brownie', price: 6000n },
  { name: 'HARİR — Pudra Şekerli Muffin', slug: 'tatli-harir-muffin', price: 5000n },
  { name: 'KARAZ — Vişneli Kek Dilimi', slug: 'tatli-karaz-visneli-kek', price: 5500n },
  { name: 'TUTYA — Çikolata Parçacıklı Kruvasan', slug: 'tatli-tutya-cikolatali-kruvasan', price: 5500n },
  { name: 'RAHLE — Portakal Kabuklu Kurabiye', slug: 'tatli-rahle-portakal-kurabiye', price: 4500n },
  { name: 'ŞEHRİYAR — Fıstıklı Nemli Kek', slug: 'tatli-sehriyar-fistikli-kek', price: 6500n },
  { name: 'LELA — Tahinli Pekmezli Kurabiye', slug: 'tatli-lela-tahinli-kurabiye', price: 4500n },
];

async function main() {
  const owner = await prisma.user.findUnique({ where: { phone: '+905111111111' } });
  if (!owner) { console.error('HATA: Satıcı bulunamadı (+905111111111). Seed çalıştı mı?'); process.exit(1); }

  let store = await prisma.store.findUnique({ where: { slug: 'demo-coffee' } });
  if (store) {
    console.log('demo-coffee zaten var:', store.id);
  } else {
    store = await prisma.store.create({
      data: {
        ownerId: owner.id,
        name: 'Bani Coffee',
        slug: 'demo-coffee',
        type: 'CAFE',
        businessUnit: 'COFFEE',
        description: 'Anadolu\'nun kadim lezzeti — özel harman kahveler ve yöresel tatlılar',
        isActive: true,
        commissionRate: 1000,
      },
    });
    console.log('demo-coffee OLUŞTURULDU:', store.id);
  }

  // Kategoriler
  let catKahve = await prisma.category.findFirst({ where: { storeId: store.id, slug: 'kahveler' } });
  if (!catKahve) catKahve = await prisma.category.create({ data: { storeId: store.id, name: 'Kahveler', slug: 'kahveler' } });

  let catTatli = await prisma.category.findFirst({ where: { storeId: store.id, slug: 'tatlilar' } });
  if (!catTatli) catTatli = await prisma.category.create({ data: { storeId: store.id, name: 'Tatlı & Fırın', slug: 'tatlilar' } });

  // Ürünleri ekle
  async function addAll(list, categoryId, label) {
    let added = 0;
    for (const s of list) {
      const exists = await prisma.product.findFirst({ where: { storeId: store.id, slug: s.slug } });
      if (!exists) {
        await prisma.product.create({
          data: { storeId: store.id, categoryId, name: s.name, slug: s.slug, price: s.price, stock: 100, unit: 'adet', isActive: true },
        });
        console.log('ürün eklendi:', s.name);
        added++;
      }
    }
    console.log(`${label}: ${added} yeni ürün (${list.length} toplam)`);
  }

  await addAll(COFFEES, catKahve.id, 'Kahveler');
  await addAll(DESSERTS, catTatli.id, 'Tatlı & Fırın');

  console.log('TAMAM ✅  Bani Coffee mağazası hazır (slug: demo-coffee)');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
