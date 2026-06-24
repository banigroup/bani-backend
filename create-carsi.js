// Bani Carsi backend magazasi + ornek urunler (desi/kg dahil).
const fs = require('fs');
const path = require('path');

try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  env.split('\n').forEach((line) => {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { console.warn('.env okunamadi'); }

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const owner = await prisma.user.findUnique({ where: { phone: '+905111111111' } });
  if (!owner) { console.error('HATA: Satici bulunamadi (+905111111111).'); process.exit(1); }

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
  } else {
    console.log('demo-carsi zaten var:', store.id);
  }

  let cat = await prisma.category.findFirst({ where: { storeId: store.id, slug: 'el-emegi' } });
  if (!cat) cat = await prisma.category.create({ data: { storeId: store.id, name: 'El Emegi', slug: 'el-emegi' } });

  const seed = [
    { name: 'El Orgusu Yun Corap', slug: 'el-orgusu-corap', price: 12000n, desi: 1, weightKg: 0.2 },
    { name: 'Bakir El Isi Cezve', slug: 'bakir-cezve', price: 35000n, desi: 4, weightKg: 1.5 },
    { name: 'Kilim Desenli Yastik', slug: 'kilim-yastik', price: 28000n, desi: 8, weightKg: 1.2 },
    { name: 'Dogal Zeytinyagi Sabunu', slug: 'zeytinyagi-sabun', price: 6000n, desi: 1, weightKg: 0.5 },
  ];

  for (const s of seed) {
    const exists = await prisma.product.findFirst({ where: { storeId: store.id, slug: s.slug } });
    if (exists) {
      await prisma.product.update({ where: { id: exists.id }, data: { desi: s.desi, weightKg: s.weightKg } });
      console.log('guncellendi:', s.name);
    } else {
      await prisma.product.create({
        data: {
          storeId: store.id, categoryId: cat.id, name: s.name, slug: s.slug,
          price: s.price, stock: 100, unit: 'adet', desi: s.desi, weightKg: s.weightKg, isActive: true,
        },
      });
      console.log('eklendi:', s.name);
    }
  }
  console.log('TAMAM');
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());