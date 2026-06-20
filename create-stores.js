// Kalan demo mağazaları (Coffee + Load) tek seferde, idempotent.
// cd "$HOME\Desktop\bani-backend"; node create-stores.js
const fs = require('fs'), path = require('path');
try { const e = fs.readFileSync(path.join(__dirname, '.env'), 'utf8'); e.split('\n').forEach(l => { const m = l.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch { }
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const STORES = [
    {
        slug: 'demo-coffee', name: 'Bani Coffee', businessUnit: 'COFFEE', type: 'SHOP',
        desc: 'Taze çekilmiş kahve ve sıcak içecekler', catName: 'Sıcak İçecekler', catSlug: 'sicak-icecekler', unit: 'fincan',
        products: [['Espresso', 'espresso', 4000n], ['Latte', 'latte', 5500n], ['Filtre Kahve', 'filtre-kahve', 4500n], ['Türk Kahvesi', 'turk-kahvesi', 3500n], ['Cappuccino', 'cappuccino', 5000n]]
    },
    {
        slug: 'demo-load', name: 'Bani Load', businessUnit: 'LOAD', type: 'SHOP',
        desc: 'Yük taşıma ve nakliye hizmetleri', catName: 'Taşıma Hizmetleri', catSlug: 'tasima', unit: 'sefer',
        products: [['Şehir İçi Taşıma', 'sehir-ici', 150000n], ['Şehirler Arası Taşıma', 'sehirler-arasi', 450000n], ['Parça Eşya Taşıma', 'parca-esya', 80000n]]
    },
];

async function ensure(def) {
    const owner = await prisma.user.findUnique({ where: { phone: '+905111111111' } });
    if (!owner) { console.error('HATA: Satıcı yok (+905111111111).'); process.exit(1); }
    let store = await prisma.store.findUnique({ where: { slug: def.slug } });
    if (!store) {
        store = await prisma.store.create({ data: { ownerId: owner.id, name: def.name, slug: def.slug, type: def.type, businessUnit: def.businessUnit, description: def.desc, isActive: true, commissionRate: 1000 } });
        console.log(def.slug + ' OLUŞTURULDU:', store.id);
    } else console.log(def.slug + ' zaten var:', store.id);
    let cat = await prisma.category.findFirst({ where: { storeId: store.id, slug: def.catSlug } });
    if (!cat) cat = await prisma.category.create({ data: { storeId: store.id, name: def.catName, slug: def.catSlug } });
    for (const [name, slug, price] of def.products) {
        const ex = await prisma.product.findFirst({ where: { storeId: store.id, slug } });
        if (!ex) { await prisma.product.create({ data: { storeId: store.id, categoryId: cat.id, name, slug, price, stock: 100, unit: def.unit, isActive: true } }); console.log('  ürün:', name); }
    }
}
(async () => { for (const s of STORES) await ensure(s); console.log('TAMAM ✅ Coffee + Load hazır'); })()
    .catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());