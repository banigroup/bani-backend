import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException,
} from '@nestjs/common';
import {
  Prisma, Role, WalletType, TransactionType, EntryDirection, OrderStatus, PaymentStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../finance/services/ledger.service';
import { WalletService } from '../finance/services/wallet.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CheckoutDto } from './dto/checkout.dto';

// --- Placeholder ayarları (sonradan mağaza/iş kuralına göre değişebilir) ---
const DELIVERY_FEE = 1500n; // 15,00 TL
const FREE_DELIVERY_THRESHOLD = 30000n; // 300 TL ve üzeri teslimat ücretsiz
const VAT_INCLUDED_RATE = 20n; // komisyon KDV dahil; KDV payı = komisyon * 20 / 120

// Satıcı/admin tarafından ileri durum geçişleri
const NEXT_STATUS: Record<string, OrderStatus[]> = {
  CONFIRMED: [OrderStatus.PREPARING],
  PREPARING: [OrderStatus.READY],
  READY: [OrderStatus.ON_THE_WAY],
  ON_THE_WAY: [OrderStatus.DELIVERED],
  DELIVERED: [],
  CANCELLED: [],
  REFUNDED: [],
  PENDING: [OrderStatus.CONFIRMED],
};

// İptal edilebilir durumlar (teslimat yola çıkmadan önce)
const CANCELABLE: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY];

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
  ) {}

  private isAdmin(user: AuthUser): boolean {
    return (user.roles ?? []).includes(Role.SUPER_ADMIN);
  }

  private orderNo(): string {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `BNG-${ymd}-${rnd}`;
  }

  // ============================ CHECKOUT ============================
  async checkout(userId: string, dto: CheckoutDto) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true } } },
    });
    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Sepet boş');
    }
    if (!cart.storeId) {
      throw new BadRequestException('Sepette mağaza bilgisi yok');
    }

    const store = await this.prisma.store.findFirst({
      where: { id: cart.storeId, isActive: true, deletedAt: null },
    });
    if (!store) throw new BadRequestException('Mağaza aktif değil');

    // Stok + tutar kontrolü
    let subtotal = 0n;
    for (const it of cart.items) {
      if (!it.product || !it.product.isActive || it.product.deletedAt) {
        throw new BadRequestException(`Ürün artık satışta değil: ${it.product?.name ?? it.productId}`);
      }
      if (it.product.stock < it.quantity) {
        throw new BadRequestException(`Yetersiz stok: ${it.product.name} (kalan ${it.product.stock})`);
      }
      subtotal += it.unitPrice * BigInt(it.quantity);
    }

    if (store.minOrder > 0n && subtotal < store.minOrder) {
      throw new BadRequestException(`Minimum sipariş tutarı: ${store.minOrder} kuruş`);
    }

    // Para hesabı
    const deliveryFee = subtotal >= FREE_DELIVERY_THRESHOLD ? 0n : DELIVERY_FEE;
    const discount = 0n;
    const total = subtotal + deliveryFee - discount;
    const commission = (subtotal * BigInt(store.commissionRate)) / 10000n; // binde -> /10000
    const vat = (commission * VAT_INCLUDED_RATE) / (100n + VAT_INCLUDED_RATE); // KDV dahil pay
    const netRevenue = subtotal - commission;

    // Müşteri bakiyesi ön kontrol (net mesaj için)
    const customerWallet = await this.wallet.getOrCreateUserWallet(userId);
    if (customerWallet.balance < total) {
      throw new BadRequestException('Yetersiz bakiye. Lütfen cüzdana para yükleyin.');
    }
    const escrowWallet = await this.wallet.getSystemWallet(WalletType.ESCROW);

    // Teslimat adresi anlık kopyası
    let addressText: string | undefined;
    if (dto.addressId) {
      const addr = await this.prisma.address.findFirst({ where: { id: dto.addressId, userId } });
      if (!addr) throw new BadRequestException('Adres bulunamadı');
      addressText = [addr.city, addr.district, addr.line1].filter(Boolean).join(' / ');
    }

    const orderNo = this.orderNo();

    // Hepsi tek transaction'da: stok düş + sipariş yarat + escrow'a al + sepeti temizle
    const order = await this.prisma.$transaction(async (tx) => {
      for (const it of cart.items) {
        await tx.product.update({
          where: { id: it.productId },
          data: { stock: { decrement: it.quantity } },
        });
      }

      const created = await tx.order.create({
        data: {
          orderNo,
          userId,
          storeId: store.id,
          businessUnit: store.businessUnit,
          status: OrderStatus.CONFIRMED,
          paymentStatus: PaymentStatus.PAID,
          subtotal,
          deliveryFee,
          discount,
          total,
          commission,
          vat,
          netRevenue,
          addressId: dto.addressId,
          addressText,
          note: dto.note,
          confirmedAt: new Date(),
          items: {
            create: cart.items.map((it) => ({
              productId: it.productId,
              name: it.product.name,
              unitPrice: it.unitPrice,
              quantity: it.quantity,
              lineTotal: it.unitPrice * BigInt(it.quantity),
            })),
          },
        },
        include: { items: true },
      });

      // Escrow'a al: müşteri -total, escrow +total
      await this.ledger.postWithTx(tx, {
        type: TransactionType.PAYMENT,
        reference: orderNo,
        orderNo,
        businessUnit: store.businessUnit,
        commission,
        vat,
        deliveryFee,
        netRevenue,
        description: `Sipariş ${orderNo} ödemesi (escrow)`,
        lines: [
          { walletId: customerWallet.id, direction: EntryDirection.DEBIT, amount: total },
          { walletId: escrowWallet.id, direction: EntryDirection.CREDIT, amount: total },
        ],
      });

      // Sepeti temizle
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { storeId: null } });

      return created;
    });

    return order;
  }

  // ============================ LİSTELEME ============================
  async myOrders(userId: string, skip = 0, take = 20) {
    return this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Math.min(take, 100),
      include: { items: true },
    });
  }

  async getOne(user: AuthUser, id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true, store: true },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    const isOwner = order.userId === user.id;
    const isStoreOwner = order.store.ownerId === user.id;
    if (!isOwner && !isStoreOwner && !this.isAdmin(user)) {
      throw new ForbiddenException('Bu siparişi görme yetkiniz yok');
    }
    return order;
  }

  async storeOrders(user: AuthUser, storeId: string, status?: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Mağaza bulunamadı');
    if (store.ownerId !== user.id && !this.isAdmin(user)) {
      throw new ForbiddenException('Bu mağazanın siparişlerini görme yetkiniz yok');
    }
    const where: Prisma.OrderWhereInput = { storeId };
    if (status && (OrderStatus as any)[status]) {
      where.status = status as OrderStatus;
    }
    return this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { items: true },
    });
  }

  // ============================ DURUM İLERLETME ============================
  async updateStatus(user: AuthUser, id: string, next: OrderStatus) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { store: true },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    if (order.store.ownerId !== user.id && !this.isAdmin(user)) {
      throw new ForbiddenException('Bu siparişi yönetme yetkiniz yok');
    }

    const allowed = NEXT_STATUS[order.status] ?? [];
    if (!allowed.includes(next)) {
      throw new ConflictException(`Geçersiz durum geçişi: ${order.status} -> ${next}`);
    }

    // Teslim edildiğinde escrow'u dağıt (satıcı + platform)
    if (next === OrderStatus.DELIVERED) {
      const escrow = await this.wallet.getSystemWallet(WalletType.ESCROW);
      const platform = await this.wallet.getSystemWallet(WalletType.PLATFORM);
      const merchantWallet = await this.wallet.getOrCreateUserWallet(order.store.ownerId);

      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.order.update({
          where: { id },
          data: { status: OrderStatus.DELIVERED, paymentStatus: PaymentStatus.RELEASED, deliveredAt: new Date() },
          include: { items: true },
        });

        const platformShare = order.commission + order.deliveryFee;
        const lines = [
          { walletId: escrow.id, direction: EntryDirection.DEBIT, amount: order.total },
          { walletId: merchantWallet.id, direction: EntryDirection.CREDIT, amount: order.netRevenue },
          { walletId: platform.id, direction: EntryDirection.CREDIT, amount: platformShare },
        ].filter((l) => l.amount > 0n);

        await this.ledger.postWithTx(tx, {
          type: TransactionType.PAYMENT,
          reference: `${order.orderNo}:settle`,
          orderNo: order.orderNo,
          businessUnit: order.businessUnit,
          commission: order.commission,
          vat: order.vat,
          deliveryFee: order.deliveryFee,
          netRevenue: order.netRevenue,
          description: `Sipariş ${order.orderNo} dağıtım (satıcı + platform)`,
          lines,
        });

        return updated;
      });
    }

    return this.prisma.order.update({
      where: { id },
      data: { status: next },
      include: { items: true },
    });
  }

  // ============================ İPTAL / İADE ============================
  async cancel(user: AuthUser, id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { store: true, items: true },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');

    const isOwner = order.userId === user.id;
    const isStoreOwner = order.store.ownerId === user.id;
    if (!isOwner && !isStoreOwner && !this.isAdmin(user)) {
      throw new ForbiddenException('Bu siparişi iptal etme yetkiniz yok');
    }
    if (!CANCELABLE.includes(order.status)) {
      throw new ConflictException(`Bu durumda iptal edilemez: ${order.status}`);
    }

    const escrow = await this.wallet.getSystemWallet(WalletType.ESCROW);
    const customerWallet = await this.wallet.getOrCreateUserWallet(order.userId);

    return this.prisma.$transaction(async (tx) => {
      // Stok geri yükle
      for (const it of order.items) {
        await tx.product.update({
          where: { id: it.productId },
          data: { stock: { increment: it.quantity } },
        });
      }

      const updated = await tx.order.update({
        where: { id },
        data: { status: OrderStatus.CANCELLED, paymentStatus: PaymentStatus.REFUNDED, cancelledAt: new Date() },
        include: { items: true },
      });

      // İade: escrow -total, müşteri +total
      await this.ledger.postWithTx(tx, {
        type: TransactionType.REFUND,
        reference: `${order.orderNo}:refund`,
        orderNo: order.orderNo,
        businessUnit: order.businessUnit,
        description: `Sipariş ${order.orderNo} iptal/iade`,
        lines: [
          { walletId: escrow.id, direction: EntryDirection.DEBIT, amount: order.total },
          { walletId: customerWallet.id, direction: EntryDirection.CREDIT, amount: order.total },
        ],
      });

      return updated;
    });
  }
}
