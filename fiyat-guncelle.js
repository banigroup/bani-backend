// Canli: Carsi urunlerinin vitrin fiyatini net'ten yeniden hesapla.
// Mevcut price = NET kabul edilir; uzerine kargo+komisyon+KDV eklenir.
// Calistir: node fiyat-guncelle.js
const fs = require('fs');
const path = require('path');
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  env.split('\n').forEach((line) => {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) {}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const KARGO = [
  { max: 5, kurus: 3000n }, { max: 10, kurus: 5000n }, { max: 15, kurus: 7000n },
  { max: 20, kurus: 10000n }, { max: 25, kurus: 13000n }, { max: 30, kurus: 15000n },
];
function kargo(desi, kg) {
  const b = Math.max(desi || 0, kg || 0);
  if (b <= 0) return 0n; if (b > 30) return null;
  const k = KARGO.find((t) => b <= t.max); return k ? k.kurus : null;
}
function vitrin(net, desi, kg, model) {
  const kg2 = kargo(desi, kg); if (kg2 === null) return null;
  const kom = (net * 15n) / 100n;
  const taban = model === 'B' ? kom : kom + kg2;
  const kdv = (taban * 20n) / 100n;
  return net + kom + kg2 + kdv;
}

async function main() {
  const store = await prisma.store.findUnique({ where: { slug: 'demo-carsi' } });
  if (!store) { console.log('demo-carsi yok'); process.exit(1); }

  const urunler = await prisma.product.findMany({ where: { storeId: store.id, deletedAt: null } });
  for (const p of urunler) {
    // mevcut price'i NET kabul et (netFiyat 0 ise)
    const net = (p.netFiyat && p.netFiyat > 0n) ? p.netFiyat : p.price;
    const model = p.satisModeli || 'A';
    const v = vitrin(net, p.desi, p.weightKg, model);
    if (v === null) { console.log('ATLANDI (30 ustu):', p.name); continue; }

    await prisma.product.update({
      where: { id: p.id },
      data: { netFiyat: net, price: v },
    });
    console.log(p.name, '| net', Number(net) / 100, 'TL -> vitrin', Number(v) / 100, 'TL');
  }
  console.log('TAMAM');
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
