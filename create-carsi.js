// Bani Çarşı backend mağazası + örnek ürünler (TEK SEFERLİK).
// Çalıştır:  cd "$HOME\Desktop\bani-backend"; node create-carsi.js
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

async function main() {
  const owner = await prisma.user.findUnique({ where: { phone: '+905111111111' } });
  if (!owner) { console.error('HATA: Satıcı bulunamadı (+905111111111). Seed çalıştı mı?'); process.exit(1); }

  let store = await prisma.store.findUnique({ where: { slug: 'demo-carsi' } });
  if (store) {
    console.log('demo-carsi zaten var:', store.id);
  } else {
    store = await prisma.store.create({
      data: {
        ownerId: owner.id,
        name: 'Bani Çarşı',
        slug: 'demo-carsi',
        type: 'SHOP',
        businessUnit: 'CARSI',
        description: 'Anadolu üreticisinden el emeği ürünler',
        isActive: true,
        commissionRate: 1000,
      },
    });
    console.log('demo-carsi OLUŞTURULDU:', store.id);
  }

  let cat = await prisma.category.findFirst({ where: { storeId: store.id, slug: 'el-emegi' } });
  if (!cat) cat = await prisma.category.create({ data: { storeId: store.id, name: 'El Emeği', slug: 'el-emegi' } });

  const seed = [
    { name: 'El Örgüsü Yün Çorap', slug: 'el-orgusu-corap', price: 12000n },
    { name: 'Bakır El İşi Cezve', slug: 'bakir-cezve', price: 35000n },
    { name: 'Kilim Desenli Yastık', slug: 'kilim-yastik', price: 28000n },
    { name: 'Doğal Zeytinyağı Sabunu', slug: 'zeytinyagi-sabun', price: 6000n },
  ];
  for (const s of seed) {
    const exists = await prisma.product.findFirst({ where: { storeId: store.id, slug: s.slug } });
    if (!exists) {
      await prisma.product.create({
        data: { storeId: store.id, categoryId: cat.id, name: s.name, slug: s.slug, price: s.price, stock: 100, unit: 'adet', isActive: true },
      });
      console.log('ürün eklendi:', s.name);
    }
  }
  console.log('TAMAM ✅  Bani Çarşı mağazası hazır (slug: demo-carsi)');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
