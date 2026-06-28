// Tek seferlik bakım script'i — Bani Çarşı ürün fiyatlarını yeni motora geçir.
//
// NE YAPAR: businessUnit=CARSI mağazalardaki ürünlerin price + muhasebe
//   kırılımını (komisyonTutari / kargoTutari / malKdvTutari / hizmetKdvTutari)
//   güncel vitrinFiyatHesapla ile yeniden hesaplar.
//
// GÜVENLİK:
//   - VARSAYILAN: DRY-RUN. Hiçbir şey yazmaz, sadece raporlar.
//   - YAZMAK İÇİN: komuta `--apply` ekle.
//   - netFiyat <= 0 olan ürünler ATLANIR (net olmadan yeniden hesaplama
//     fiyatı bozar) ve "elle bakılacak" olarak işaretlenir.
//
// ÇALIŞTIRMA (önce dry-run):
//   railway run npx ts-node prisma/recalc-carsi-fiyat.ts
//   railway run npx ts-node prisma/recalc-carsi-fiyat.ts --apply

import { PrismaClient, BusinessUnit } from '@prisma/client';
import { vitrinFiyatHesapla } from '../src/delivery/pricing';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const tl = (k: bigint) => (Number(k) / 100).toFixed(2).padStart(10);

async function main() {
  console.log(`\n=== Çarşı fiyat recalc — ${APPLY ? '🔴 APPLY (YAZAR)' : '🟢 DRY-RUN (yazmaz)'} ===\n`);

  const urunler = await prisma.product.findMany({
    where: { deletedAt: null, store: { is: { businessUnit: BusinessUnit.CARSI } } },
    include: { store: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Toplam ${urunler.length} Çarşı ürünü bulundu.\n`);

  let degisecek = 0;
  let atlanan = 0;
  let degismeyen = 0;

  for (const u of urunler) {
    // netFiyat yoksa güvenli şekilde yeniden hesaplanamaz -> atla
    if (u.netFiyat <= 0n) {
      atlanan++;
      console.log(`  ⚠️  ATLA  [${u.store.name}] ${u.name}  — netFiyat YOK (price=${tl(u.price)}), elle bakılmalı`);
      continue;
    }

    const h = vitrinFiyatHesapla(u.netFiyat, u.desi, u.weightKg, u.satisModeli, u.kdvOrani);
    if (!h.ok) {
      atlanan++;
      console.log(`  ⚠️  ATLA  [${u.store.name}] ${u.name}  — hesap hatası: ${h.sebep}`);
      continue;
    }

    const yeniKargo = h.kargoKurus + h.yuvarlamaKurus;
    const fark = h.vitrinKurus - u.price;

    if (fark === 0n && u.komisyonTutari === h.komisyonKurus && u.malKdvTutari === h.malKdvKurus) {
      degismeyen++;
      continue; // zaten güncel
    }

    degisecek++;
    console.log(
      `  • [${u.store.name}] ${u.name}\n` +
      `      eski price=${tl(u.price)}  ->  yeni=${tl(h.vitrinKurus)}  (fark ${tl(fark)})\n` +
      `      net=${tl(u.netFiyat)} kom=${tl(h.komisyonKurus)} kargo=${tl(yeniKargo)} malKDV=${tl(h.malKdvKurus)} hizKDV=${tl(h.hizmetKdvKurus)} [KDV %${u.kdvOrani}]`,
    );

    if (APPLY) {
      await prisma.product.update({
        where: { id: u.id },
        data: {
          price: h.vitrinKurus,
          komisyonTutari: h.komisyonKurus,
          kargoTutari: yeniKargo,
          malKdvTutari: h.malKdvKurus,
          hizmetKdvTutari: h.hizmetKdvKurus,
        },
      });
    }
  }

  console.log(`\n=== ÖZET ===`);
  console.log(`  Değişecek : ${degisecek}`);
  console.log(`  Zaten güncel: ${degismeyen}`);
  console.log(`  Atlanan (elle bak): ${atlanan}`);
  console.log(
    APPLY
      ? `\n✅ ${degisecek} ürün güncellendi.\n`
      : `\nℹ️  DRY-RUN — hiçbir şey yazılmadı. Onaylıyorsan: ...recalc-carsi-fiyat.ts --apply\n`,
  );
}

main()
  .catch((e) => {
    console.error('HATA:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
