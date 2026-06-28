import {
  Injectable, NotFoundException, ForbiddenException, ConflictException,
} from '@nestjs/common';
import {
  Role, WalletType, TransactionType, EntryDirection, OrderStatus, PaymentStatus, DeliveryStatus, BusinessUnit,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../finance/services/ledger.service';
import { WalletService } from '../finance/services/wallet.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
  ) { }

  private isCourier(user: AuthUser): boolean {
    const roles = user.roles ?? [];
    return roles.includes(Role.COURIER) || roles.includes(Role.SUPER_ADMIN);
  }

  private assertCourier(user: AuthUser) {
    if (!this.isCourier(user)) {
      throw new ForbiddenException('Bu işlem için kurye yetkisi gerekli');
    }
  }

  // Havuz: hazır (READY) ve henüz kuryesi olmayan teslimatlar (Çarşı DIŞI)
  async available(user: AuthUser) {
    this.assertCourier(user);
    return this.prisma.delivery.findMany({
      where: { status: DeliveryStatus.PENDING, order: { status: OrderStatus.READY, businessUnit: { not: BusinessUnit.CARSI } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: {
        order: {
          select: {
            id: true, orderNo: true, total: true, deliveryFee: true,
            addressText: true, storeId: true,
            store: { select: { name: true, city: true, district: true, line1: true } },
          },
        },
      },
    });
  }

  // DicleFul kargo havuzu: SADECE Carsi (kargo) siparisleri
  async cargoQueue(user: AuthUser) {
    this.assertCourier(user);
    return this.prisma.delivery.findMany({
      where: { status: DeliveryStatus.PENDING, order: { status: OrderStatus.READY, businessUnit: BusinessUnit.CARSI } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { order: { select: { id: true, orderNo: true, total: true, deliveryFee: true, addressText: true, contactPhone: true, storeId: true, store: { select: { name: true, city: true, district: true, line1: true } } } } },
    });
  }

  // Kuryenin kendi teslimatlari
  async mine(user: AuthUser, status?: string) {
    this.assertCourier(user);
    const where: any = { courierId: user.id };
    if (status && (DeliveryStatus as any)[status]) where.status = status as DeliveryStatus;
    return this.prisma.delivery.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { order: { select: { id: true, orderNo: true, total: true, status: true, addressText: true } } },
    });
  }

  private async load(id: string) {
    const d = await this.prisma.delivery.findUnique({
      where: { id },
      include: { order: { include: { store: true } } },
    });
    if (!d) throw new NotFoundException('Teslimat bulunamadı');
    return d;
  }

  // Üstlen: PENDING + sipariş READY ise kuryeye ata
  async claim(user: AuthUser, id: string) {
    this.assertCourier(user);
    const d = await this.load(id);
    if (d.status !== DeliveryStatus.PENDING) {
      throw new ConflictException('Bu teslimat zaten üstlenilmiş');
    }
    if (d.order.status !== OrderStatus.READY) {
      throw new ConflictException('Sipariş henüz teslimata hazır değil');
    }
    return this.prisma.delivery.update({
      where: { id },
      data: { courierId: user.id, status: DeliveryStatus.ASSIGNED, assignedAt: new Date() },
      include: { order: { select: { id: true, orderNo: true, status: true } } },
    });
  }

  // Aldım: ASSIGNED -> PICKED_UP, sipariş -> ON_THE_WAY
  async pickup(user: AuthUser, id: string) {
    this.assertCourier(user);
    const d = await this.load(id);
    if (d.courierId !== user.id && !(user.roles ?? []).includes(Role.SUPER_ADMIN)) {
      throw new ForbiddenException('Bu teslimat size atanmamış');
    }
    if (d.status !== DeliveryStatus.ASSIGNED) {
      throw new ConflictException(`Bu durumda alınamaz: ${d.status}`);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: d.orderId }, data: { status: OrderStatus.ON_THE_WAY } });
      return tx.delivery.update({
        where: { id },
        data: { status: DeliveryStatus.PICKED_UP, pickedUpAt: new Date() },
        include: { order: { select: { id: true, orderNo: true, status: true } } },
      });
    });
  }

  // Teslim ettim: PICKED_UP -> DELIVERED, sipariş -> DELIVERED, escrow dağıtımı
  async deliver(user: AuthUser, id: string) {
    this.assertCourier(user);
    const d = await this.load(id);
    if (d.courierId !== user.id && !(user.roles ?? []).includes(Role.SUPER_ADMIN)) {
      throw new ForbiddenException('Bu teslimat size atanmamış');
    }
    if (d.status !== DeliveryStatus.PICKED_UP) {
      throw new ConflictException(`Bu durumda teslim edilemez: ${d.status}`);
    }
    const order = d.order;
    const isCarsi = order.businessUnit === BusinessUnit.CARSI;

    // Cüzdanları transaction dışında çöz
    const escrow = await this.wallet.getSystemWallet(WalletType.ESCROW);
    const platform = await this.wallet.getSystemWallet(WalletType.PLATFORM);
    const merchantWallet = await this.wallet.getOrCreateUserWallet(order.store.ownerId);
    const courierWallet = await this.wallet.getOrCreateUserWallet(user.id);

    return this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.DELIVERED, paymentStatus: PaymentStatus.RELEASED, deliveredAt: new Date() },
      });
      const updated = await tx.delivery.update({
        where: { id },
        data: { status: DeliveryStatus.DELIVERED, deliveredAt: new Date() },
        include: { order: { select: { id: true, orderNo: true, status: true } } },
      });

      // ---- Dağıtım ----
      let lines: { walletId: string; direction: EntryDirection; amount: bigint }[];

      if (isCarsi) {
        // Çarşı: kargo ürüne gömülü -> DicleFul'e (şimdilik PLATFORM cüzdanı) gider.
        //   satıcı  = netRevenue (net + mal KDV) — kargoyu ALMAZ
        //   platform = komisyon + hizmet KDV + DicleFul kargo (deliveryFee)
        //   kurye    = order'dan pay almaz (DicleFul kuryesi ayrı ödenir)
        // NOT: komisyon/vat/deliveryFee Order'da ayrı tutulduğu için muhasebe
        //      DicleFul kargosunu platform komisyonundan ayrıştırabilir.
        lines = [
          { walletId: escrow.id, direction: EntryDirection.DEBIT, amount: order.total },
          { walletId: merchantWallet.id, direction: EntryDirection.CREDIT, amount: order.netRevenue },
          { walletId: platform.id, direction: EntryDirection.CREDIT, amount: order.commission + order.vat + order.deliveryFee },
        ];
      } else {
        // Çarşı dışı: mevcut akış — kurye teslimat ücretini alır
        lines = [
          { walletId: escrow.id, direction: EntryDirection.DEBIT, amount: order.total },
          { walletId: merchantWallet.id, direction: EntryDirection.CREDIT, amount: order.netRevenue },
          { walletId: platform.id, direction: EntryDirection.CREDIT, amount: order.commission },
          { walletId: courierWallet.id, direction: EntryDirection.CREDIT, amount: order.deliveryFee },
        ];
      }
      lines = lines.filter((l) => l.amount > 0n);

      await this.ledger.postWithTx(tx, {
        type: TransactionType.PAYMENT,
        reference: `${order.orderNo}:settle`,
        orderNo: order.orderNo,
        businessUnit: order.businessUnit,
        commission: order.commission,
        vat: order.vat,
        deliveryFee: order.deliveryFee,
        netRevenue: order.netRevenue,
        description: isCarsi
          ? `Sipariş ${order.orderNo} dağıtım (satıcı + platform + DicleFul kargo)`
          : `Sipariş ${order.orderNo} dağıtım (satıcı + platform + kurye)`,
        lines,
      });

      return updated;
    });
  }
}
