import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Tum tutarlar KURUS (BigInt). Response'ta Number'a ceviriyoruz (frontend /100 yapar).
@Injectable()
export class SuperadminService {
  constructor(private readonly prisma: PrismaService) {}

  private num(v: bigint | null | undefined): number {
    return Number(v ?? 0n);
  }

  async overview() {
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
}
