import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// HOLDING OKUMA YOLU — capraz-dikey raporlamanin TEK TOPLANMA NOKTASI.
//
// NEDEN AYRI BIR MODUL: bu iki uc bilerek capraz-dikeydir (holding raporlamasi
// zaten bunun icin var). Amac veri modelini degistirmek DEGIL; ileride dikeyler
// fiziksel olarak ayri veritabanlarina bolundugunde HANGI UCUN NEREDEN
// BESLENECEGINI simdiden gorunur kilmak. Ikisi finance ve superadmin
// modullerine dagilmis haldeyken bu soru tek bakista cevaplanamiyordu.
//
// IKISI AYNI SEY DEGIL — ayrimin tam yeri burasi:
//
//   dikeyPnl()      -> YALNIZCA transactions tablosu. groupBy(businessUnit),
//                      tek tablo, SIFIR join. Transaction'in Store'a, Order'a
//                      ya da User'a FK'si yok (orderNo duz String). Defterin
//                      kendi tablosundan besleniyor, yani FIZIKSEL AYRIMDA
//                      OLDUGU GIBI CALISIR.
//
//   ticaretOzeti()  -> orders (ticaret dikeyi) + stores + stores.owner (User)
//                      iliski join'i. FIZIKSEL AYRIMDA CALISMAZ: byStore blogu
//                      tek sorguda iki veritabanina duser. Ayrim gelmeden once
//                      bu blogun beslenme yolu yeniden tasarlanmali (ornegin
//                      ticaret tarafindan uretilip holdinge akan bir ozet).
//
// BILINEN BOSLUK (backlog, MEDIUM): bugun IKISI DE yalnizca TICARET kumesini
// raporluyor. ':settle' referansi sadece delivery.service'te uretiliyor ve
// Order yalnizca orders.service'te yaratiliyor; LOAD komisyonu ise deftere hic
// girmeden komisyon_odemeleri tablosunda yasiyor. Yani "holding raporu" bugun
// pratikte "ticaret raporu"dur. Bu paket veri modelini DEGISTIRMEDI - bosluk
// bilerek oldugu yerde birakildi, kapatilmasi ayri bir istir.
//
// TASIMA SIRASINDA DAVRANIS DEGISMEDI: govdeler finance.service.ts ve
// superadmin.service.ts'ten BIREBIR tasindi, yalnizca metot adlari degisti
// (businessUnitReport -> dikeyPnl, overview -> ticaretOzeti). Rotalar, izinler
// ve yanit govdeleri aynen korundu; iki ucun yaniti tasima oncesi/sonrasi
// bayt-birebir dogrulandi.
//
// Tum tutarlar KURUS (BigInt). Response'ta Number'a ceviriyoruz (frontend /100 yapar).
@Injectable()
export class HoldingService {
  constructor(private readonly prisma: PrismaService) {}

  private num(v: bigint | null | undefined): number {
    return Number(v ?? 0n);
  }

  async ticaretOzeti() {
    // Iptal edilenler ciroya girmez (gercek muhasebe).
    // NOT: Eger derleyici "OrderStatus.CANCELLED" hatasi verirse, asagidaki
    // 3 yerde de where'i { } (bos) yap veya dogru enum adini koy.
    const where = { status: { not: OrderStatus.CANCELLED } };

    const sumSelect = {
      total: true,
      subtotal: true,
      commission: true,
      netRevenue: true,
      vat: true,
      deliveryFee: true,
    } as const;

    // ---- GENEL TOPLAM ----
    const totals = await this.prisma.order.aggregate({
      _sum: sumSelect,
      _count: { _all: true },
      where,
    });

    // ---- FIRMA (businessUnit) BAZLI ----
    const unitRows = await this.prisma.order.groupBy({
      by: ['businessUnit'],
      _sum: sumSelect,
      _count: { _all: true },
      where,
    });

    // ---- SATICI (store) BAZLI ----
    const storeRows = await this.prisma.order.groupBy({
      by: ['storeId'],
      _sum: sumSelect,
      _count: { _all: true },
      where,
    });

    const storeIds = storeRows.map((r) => r.storeId);
    const stores = await this.prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: {
        id: true,
        name: true,
        slug: true,
        businessUnit: true,
        commissionRate: true,
        owner: { select: { name: true, surname: true, phone: true } },
      },
    });
    const storeMap = new Map(stores.map((s) => [s.id, s]));

    return {
      totals: {
        orders: totals._count._all,
        gmv: this.num(totals._sum.total), // ciro = musterinin odedigi
        subtotal: this.num(totals._sum.subtotal),
        commission: this.num(totals._sum.commission), // PLATFORM geliri
        netRevenue: this.num(totals._sum.netRevenue), // satici hakedisi
        vat: this.num(totals._sum.vat),
        deliveryFee: this.num(totals._sum.deliveryFee),
      },
      byUnit: unitRows
        .map((r) => ({
          businessUnit: r.businessUnit,
          orders: r._count._all,
          gmv: this.num(r._sum.total),
          subtotal: this.num(r._sum.subtotal),
          commission: this.num(r._sum.commission),
          netRevenue: this.num(r._sum.netRevenue),
          vat: this.num(r._sum.vat),
        }))
        .sort((a, b) => b.commission - a.commission),
      byStore: storeRows
        .map((r) => {
          const s = storeMap.get(r.storeId);
          const ownerName = s?.owner
            ? [s.owner.name, s.owner.surname].filter(Boolean).join(' ').trim()
            : '';
          return {
            storeId: r.storeId,
            name: s?.name ?? '(silinmis magaza)',
            slug: s?.slug ?? '',
            businessUnit: s?.businessUnit ?? null,
            commissionRate: s?.commissionRate ?? null, // binde (1000 = %10) -> %= /100
            owner: ownerName || '—',
            ownerPhone: s?.owner?.phone ?? '',
            orders: r._count._all,
            gmv: this.num(r._sum.total),
            subtotal: this.num(r._sum.subtotal),
            commission: this.num(r._sum.commission),
            netRevenue: this.num(r._sum.netRevenue),
            vat: this.num(r._sum.vat),
          };
        })
        .sort((a, b) => b.commission - a.commission),
    };
  }

  // ============================ DİKEY BAZLI P&L RAPORU ============================
  // Her businessUnit (Market/Yemek/Çarşı/Coffee/Load/DicleFul) için gerçekleşen
  // (teslim edilmiş) sipariş ekonomisi: ciro, komisyon, KDV, kargo/teslimat, net gelir.
  //
  // ÇİFT SAYIM YOK: her sipariş 2 işlem üretir (checkout escrow + teslimat dağıtım).
  //   Sadece ':settle' (dağıtım = gerçekleşmiş) işlemleri sayılır.
  // Tutarlar kuruş cinsindendir.
  async dikeyPnl(from?: Date, to?: Date) {
    const where: Prisma.TransactionWhereInput = {
      reference: { endsWith: ':settle' }, // yalnızca gerçekleşen dağıtım
    };
    if (from || to) {
      where.createdAt = {};
      if (from) (where.createdAt as Prisma.DateTimeFilter).gte = from;
      if (to) (where.createdAt as Prisma.DateTimeFilter).lte = to;
    }

    const grouped = await this.prisma.transaction.groupBy({
      by: ['businessUnit'],
      where,
      _count: { _all: true },
      _sum: { amount: true, commission: true, vat: true, deliveryFee: true, netRevenue: true },
    });

    const n = (v: bigint | null | undefined) => Number(v ?? 0n);

    const satirlar = grouped.map((g) => ({
      businessUnit: g.businessUnit,
      islemSayisi: g._count._all,
      ciro: n(g._sum.amount), // müşterinin ödediği toplam (kuruş)
      komisyon: n(g._sum.commission), // platform komisyonu
      kdv: n(g._sum.vat), // KDV payı
      kargoTeslimat: n(g._sum.deliveryFee), // Çarşı=DicleFul kargo / diğer=kurye
      netGelir: n(g._sum.netRevenue), // satıcı hakedişi
    }));
    satirlar.sort((a, b) => b.ciro - a.ciro);

    const toplam = satirlar.reduce(
      (acc, s) => ({
        islemSayisi: acc.islemSayisi + s.islemSayisi,
        ciro: acc.ciro + s.ciro,
        komisyon: acc.komisyon + s.komisyon,
        kdv: acc.kdv + s.kdv,
        kargoTeslimat: acc.kargoTeslimat + s.kargoTeslimat,
        netGelir: acc.netGelir + s.netGelir,
      }),
      { islemSayisi: 0, ciro: 0, komisyon: 0, kdv: 0, kargoTeslimat: 0, netGelir: 0 },
    );

    return {
      donem: { from: from ?? null, to: to ?? null },
      paraBirimi: 'kuruş',
      not: 'Yalnızca teslim edilmiş (gerçekleşen) siparişler. Escrow’da bekleyenler dahil değildir.',
      satirlar,
      toplam,
    };
  }
}
