// Test: sabuna net fiyat + desi ver, vitrin fiyatini hesapla, sonucu goster.
// Calistir: node test-fiyat.js
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

// pricing.ts mantiginin js kopyasi (test icin)
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
  return { vitrin: net + kom + kg2 + kdv, net, kom, kargo: kg2, kdv };
}

async function main() {
  // Sabun: net 100 TL (10000 kurus), 1 desi, model A
  const net = 10000n, desi = 1, kg = 0.5, model = 'A';
  const h = vitrin(net, desi, kg, model);

  const p = await prisma.product.findFirst({ where: { slug: 'zeytinyagi-sabun' } });
  if (!p) { console.log('sabun bulunamadi'); process.exit(1); }

  await prisma.product.update({
    where: { id: p.id },
    data: { netFiyat: net, desi, weightKg: kg, kdvOrani: 20, satisModeli: model, price: h.vitrin },
  });

  console.log('--- SABUN FIYAT TESTI (model A) ---');
  console.log('Net      :', Number(h.net) / 100, 'TL');
  console.log('Komisyon :', Number(h.kom) / 100, 'TL  (%15)');
  console.log('Kargo    :', Number(h.kargo) / 100, 'TL  (1 desi -> 0-5)');
  console.log('KDV      :', Number(h.kdv) / 100, 'TL  ((kom+kargo)*%20)');
  console.log('VITRIN   :', Number(h.vitrin) / 100, 'TL  <- musteri bunu gorur');
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
