import { BusinessUnit, SellerStatus, SellerType, SellerVerification, UserStatus, WalletType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';
import { LedgerService } from '../finance/services/ledger.service';
import { WalletService } from '../finance/services/wallet.service';
import { OrderStatusService } from './order-status.service';

const DB = 'bani_test';
function testUrl() {
  const raw = process.env.INTEGRATION_DATABASE_URL;
  if (!raw) throw new Error('INTEGRATION_DATABASE_URL zorunlu; DATABASE_URL fallback yok.');
  const u = new URL(raw);
  if (decodeURIComponent(u.pathname).replace(/^\//, '') !== DB) throw new Error(`GUVENLIK DURDURMASI: yalniz ${DB}`);
  return raw;
}

describe('CART-01 Kervan multi-store checkout / real PostgreSQL', () => {
  let prisma: PrismaService;
  let orders: OrdersService;
  let userId = '';
  let addressId = '';
  const storeIds: string[] = [];
  const productIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService({ datasources: { db: { url: testUrl() } } });
    await prisma.$connect();
    const ledger = new LedgerService(prisma);
    const wallet = new WalletService(prisma);
    const market = { acikMi: async () => true } as any;
    const bildirim = { gonderSms: async () => undefined } as any;
    orders = new OrdersService(prisma, ledger, wallet, new OrderStatusService(), bildirim, market);

    const user = await prisma.user.create({ data: { phone: `KMS-${Date.now()}`, status: UserStatus.ACTIVE } });
    userId = user.id;
    addressId = (await prisma.address.create({ data: { userId, city: 'Izmir', district: 'Test', line1: 'Test adresi' } })).id;
    const uw = await wallet.getOrCreateUserWallet(userId);
    await prisma.wallet.update({ where: { id: uw.id }, data: { balance: 1000000n } });

    for (let i = 1; i <= 2; i++) {
      const owner = await prisma.user.create({ data: { phone: `KMS-O-${Date.now()}-${i}`, status: UserStatus.ACTIVE } });
      const seller = await prisma.seller.create({ data: { ownerUserId: owner.id, sellerType: SellerType.MARKET, legalName: `KMS ${i}`, displayName: `KMS ${i}`, talepEdilenDikey: BusinessUnit.CARSI, status: SellerStatus.ACTIVE, verification: SellerVerification.ONAYLANDI } });
      const store = await prisma.store.create({ data: { ownerId: owner.id, sellerId: seller.id, name: `KMS Store ${i}`, slug: `kms-${Date.now()}-${i}`, businessUnit: BusinessUnit.CARSI, isActive: true } });
      storeIds.push(store.id);
      const product = await prisma.product.create({ data: { storeId: store.id, name: `KMS Product ${i}`, slug: `kms-p-${Date.now()}-${i}`, price: 10000n * BigInt(i), stock: 10, netFiyat: 8000n * BigInt(i), komisyonTutari: 1000n * BigInt(i), malKdvTutari: 800n * BigInt(i), hizmetKdvTutari: 200n * BigInt(i), kargoTutari: 0n } });
      productIds.push(product.id);
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    testUrl();
    const owners = (await prisma.store.findMany({ where: { id: { in: storeIds } }, select: { ownerId: true, sellerId: true } }));
    const groupNos = (await prisma.orderGroup.findMany({ where: { userId }, select: { groupNo: true } })).map(g => g.groupNo);
    if (groupNos.length) await prisma.transaction.deleteMany({ where: { reference: { in: groupNos } } });
    await prisma.cart.deleteMany({ where: { userId } });
    await prisma.orderGroup.deleteMany({ where: { userId } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    await prisma.seller.deleteMany({ where: { id: { in: owners.map(x => x.sellerId) } } });
    await prisma.wallet.deleteMany({ where: { userId } });
    await prisma.address.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, ...owners.map(x => x.ownerId)] } } });
    await prisma.$disconnect();
  });

  async function cartKur(stockFailure = false) {
    const cart = await prisma.cart.upsert({ where: { userId_businessUnit: { userId, businessUnit: BusinessUnit.CARSI } }, update: { storeId: null }, create: { userId, businessUnit: BusinessUnit.CARSI } });
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    for (let i = 0; i < 2; i++) await prisma.cartItem.create({ data: { cartId: cart.id, productId: productIds[i], quantity: stockFailure && i === 1 ? 999 : 1, unitPrice: 10000n * BigInt(i + 1) } });
    return cart;
  }

  it('2 magaza -> 1 OrderGroup + 2 child Order + 2 Delivery + tek PAYMENT', async () => {
    await cartKur();
    const result: any = await orders.checkout(userId, { addressId } as any, 'https://www.banikervan.com.tr', 'CARSI');
    expect(result.orders).toHaveLength(2);
    expect(result.total).toBe(30000n);
    const group = await prisma.orderGroup.findUniqueOrThrow({ where: { id: result.id }, include: { orders: { include: { delivery: true } } } });
    expect(group.orders).toHaveLength(2);
    expect(new Set(group.orders.map(o => o.storeId))).toEqual(new Set(storeIds));
    expect(group.orders.every(o => !!o.delivery)).toBe(true);
    expect(group.orders.reduce((t, o) => t + o.total, 0n)).toBe(group.total);
    const payments = await prisma.transaction.findMany({ where: { reference: group.groupNo } });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(group.total);
    expect((await prisma.cartItem.count({ where: { cart: { userId, businessUnit: BusinessUnit.CARSI } } }))).toBe(0);
  });

  it('bir magazada stok yetersizse hicbir yeni group/order/payment yazilmaz ve sepet korunur', async () => {
    const cart = await cartKur(true);
    const beforeGroups = await prisma.orderGroup.count({ where: { userId } });
    const beforeOrders = await prisma.order.count({ where: { userId, businessUnit: BusinessUnit.CARSI } });
    const beforePayments = await prisma.transaction.count({ where: { businessUnit: BusinessUnit.CARSI, description: { startsWith: 'Siparis grubu BNG-' } } });
    await expect(orders.checkout(userId, { addressId } as any, 'https://www.banikervan.com.tr', 'CARSI')).rejects.toBeDefined();
    expect(await prisma.orderGroup.count({ where: { userId } })).toBe(beforeGroups);
    expect(await prisma.order.count({ where: { userId, businessUnit: BusinessUnit.CARSI } })).toBe(beforeOrders);
    expect(await prisma.transaction.count({ where: { businessUnit: BusinessUnit.CARSI, description: { startsWith: 'Siparis grubu BNG-' } } })).toBe(beforePayments);
    expect(await prisma.cartItem.count({ where: { cartId: cart.id } })).toBe(2);
  });
});