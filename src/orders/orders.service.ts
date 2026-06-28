import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException,
} from '@nestjs/common';
import {
  Prisma, Role, WalletType, TransactionType, EntryDirection, OrderStatus, PaymentStatus, DeliveryStatus, BusinessUnit,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../finance/services/ledger.service';
import { WalletService } from '../finance/services/wallet.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { CheckoutDto } from './dto/checkout.dto';

// --- Placeholder ayarları (Çarşı DIŞI dikeyler için) ---
const DELIVERY_FEE = 1500n; // 15,00 TL
const FREE_DELIVERY_THRESHOLD = 30000n; // 300 TL ve üzeri teslimat ücretsiz
const VAT_INCLUDED_RATE = 20n; // komisyon KDV dahil; KDV payı = komisyon * 20 / 120

// Satıcı/admin tarafından ileri durum geçişleri (READY'den sonrasını KURYE devralır)
const NEXT_STATUS: Record<string, OrderStatus[]> = {
  CONFIRMED: [OrderStatus.PREPARING],
  PREPARING: [OrderStatus.READY],
  READY: [], // kurye teslimatı devralır (Faz 4)
  ON_THE_WAY: [],
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
  ) { }

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

    const isCarsi = store.businessUnit === BusinessUnit.CARSI;

    // Stok + tutar kontrolü (+ Çarşı için gömülü muhasebe kırılımı toplama)
    let subtotal = 0n;
    // Çarşı gömülü kalemleri (ürün fiyatına dahil):
    let carsiKargo = 0n; // DicleFul kargo
    let carsiKom = 0n; // platform komisyonu (%15)
    let carsiHizmetKdv = 0n; // platform hizmet KDV'si
    let carsiMalKdv = 0n; // satıcının KDV'si
    let carsiNet = 0n; // satıcının net malı

    for (const it of cart.items) {
      if (!it.product || !it.product.isActive || it.product.deletedAt) {
        throw new BadRequestException(`Ürün artık satışta değil: ${it.product?.name ?? it.productId}`);
      }
      if (it.product.stock < it.quantity) {
        throw new BadRequestException(`Yetersiz stok: ${it.product.name} (kalan ${it.product.stock})`);
      }
      const q = BigInt(it.quantity);
      if (isCarsi) {
        // Çarşı: kargo + komisyon + KDV ürün fiyatına GÖMÜLÜ.
        // subtotal'ı güncel ürün fiyatından kur (kırılımla birebir uyuşsun).
        subtotal += it.product.price * q;
        carsiKargo += it.product.kargoTutari * q;
        carsiKom += it.product.komisyonTutari * q;
        carsiHizmetKdv += it.product.hizmetKdvTutari * q;
        carsiMalKdv += it.product.malKdvTutari * q;
        carsiNet += it.product.netFiyat * q;
      } else {
        subtotal += it.unitPrice * q;
      }
    }

    if (store.minOrder > 0n && subtotal < store.minOrder) {
      throw new BadRequestException(`Minimum sipariş tutarı: ${store.minOrder} kuruş`);
    }

    // ---- Para hesabı ----
    const discount = 0n;
    let deliveryFee: bigint;
    let commission: bigint;
    let vat: bigint;
    let netRevenue: bigint;
    let total: bigint;

    if (isCarsi) {
      // Kargo ürün fiyatına gömülü; AYRI EKLENMEZ (çift kargo önlenir).
      // deliveryFee = gömülü kargo (teslimatta DicleFul'e yönlendirilir).
      deliveryFee = carsiKargo;
      commission = carsiKom; // platform komisyonu (gömülü %15)
      vat = carsiHizmetKdv; // platform hizmet KDV'si
      netRevenue = carsiNet + carsiMalKdv; // satıcının eline geçen (mal + mal KDV)
      total = subtotal; // kargo zaten subtotal içinde -> ek YOK
      // Tutarlılık güvencesi: dağıtım kalemleri subtotal'a birebir oturmalı
      const dagitim = netRevenue + commission + vat + deliveryFee;
      if (dagitim !== subtotal) {
        throw new BadRequestException(
          `Çarşı tutar tutarsızlığı: dağıtım ${dagitim} ≠ subtotal ${subtotal}`,
        );
      }
    } else {
      deliveryFee = subtotal >= FREE_DELIVERY_THRESHOLD ? 0n : DELIVERY_FEE;
      commission = (subtotal * BigInt(store.commissionRate)) / 10000n; // binde -> /10000
      vat = (commission * VAT_INCLUDED_RATE) / (100n + VAT_INCLUDED_RATE); // KDV dahil pay
      netRevenue = subtotal - commission;
      total = subtotal + deliveryFee - discount;
    }

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
          contactPhone: dto.contactPhone,
          confirmedAt: new Date(),
          items: {
            create: cart.items.map((it) => {
              // Çarşı'da OrderItem fiyatı güncel ürün fiyatı (kırılımla uyumlu)
              const up = isCarsi ? it.product.price : it.unitPrice;
              return {
                productId: it.productId,
                name: it.product.name,
                unitPrice: up,
                quantity: it.quantity,
                lineTotal: up * BigInt(it.quantity),
              };
            }),
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

      // Teslimat kaydı (havuzda bekliyor). Çarşı = DicleFul kargo havuzu.
      await tx.delivery.create({
        data: { orderId: created.id, fee: deliveryFee, status: DeliveryStatus.PENDING },
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
      include: { items: true, store: { select: { name: true } } },
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

      // Teslimat kaydını iptal et (varsa)
      await tx.delivery.updateMany({
        where: { orderId: id },
        data: { status: DeliveryStatus.CANCELLED },
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
