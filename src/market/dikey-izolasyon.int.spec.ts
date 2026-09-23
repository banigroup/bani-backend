// VERT-01 / P1 — DIKEY VE HEDEF MAGAZA IZOLASYONU — ENTEGRASYON. GERCEK PostgreSQL GEREKTIRIR.
//
// NE KANITLIYOR (kabul senaryolari, gercek servis yollari + gercek izin matrisi):
//   S1  MARKET baglami -> YEMEK magaza guncelleme = 403
//   S2  MARKET baglami -> CARSI urun guncelleme = 403
//   S3  MARKET baglami -> YEMEK siparis durumu = 403
//   S4  MARKET sahibi + YEMEK personeli, MARKET baglaminda YEMEK kaynagina erisemez
//   S5  ayni kisi YEMEK baglaminda YETKILI oldugu YEMEK kaynagina erisir
//   S6  magaza rolu birlesimi dikeyler arasi yazma yetkisi uretmez
//   S7  ADMIN / SUPER_ADMIN dikeyler arasi erisimi korunur
//   S8  eksik/gecersiz baglam tek davranis: 400 DIKEY_BAGLAMI_GEREKLI
//   S9  my/stores yalniz aktif dikey (cok dikeyli satici)
//   S10 tek dikeyli satici akisinda regresyon yok
//   +   bootstrap / basvuru / KYC / ilk magaza kurulumu basliksiz calisir (muaf)
//
// CALISTIRMA: `pnpm run test:int` + INTEGRATION_DATABASE_URL (bani_test).
// FAIL-CLOSED: hedef veritabani 'bani_test' degilse HICBIR baglanti kurulmaz.
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BusinessUnit, OrderStatus, Role, SellerStatus, SellerType, SellerVerification, UserStatus } from '@prisma/client';
import { MarketService } from './market.service';
import { SellerStatusService } from './seller-status.service';
import { AuditService } from '../common/audit/audit.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { CatalogService } from '../catalog/catalog.service';
import { OrdersService } from '../orders/orders.service';
import { OrderStatusService } from '../orders/order-status.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

// ============================================================ GUVENLIK KAPISI

const BEKLENEN_VERITABANI = 'bani_test';

function testVeritabaniUrl(): string {
  const url = process.env.INTEGRATION_DATABASE_URL;
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error(
      'INTEGRATION_DATABASE_URL tanimli degil. Entegrasyon testleri YALNIZ ayrilmis ' +
        `bir '${BEKLENEN_VERITABANI}' veritabaninda calisir; DATABASE_URL fallback ` +
        'olarak KULLANILMAZ.',
    );
  }
  let ayristirilmis: URL;
  try {
    ayristirilmis = new URL(url);
  } catch {
    throw new Error('INTEGRATION_DATABASE_URL gecerli bir URL degil.');
  }
  const veritabaniAdi = decodeURIComponent(ayristirilmis.pathname).replace(/^\//, '');
  if (veritabaniAdi !== BEKLENEN_VERITABANI) {
    throw new Error(
      `GUVENLIK DURDURMASI: hedef veritabani '${veritabaniAdi}'. Bu paket fixture ` +
        `olusturur ve siler; yalnizca '${BEKLENEN_VERITABANI}' uzerinde calismasina ` +
        'izin verilir.',
    );
  }
  return url;
}

// =================================================================== fixture

const KOSU = randomUUID().slice(0, 8);
const { MARKET, YEMEK, CARSI } = BusinessUnit;
const MERCHANT = [Role.CUSTOMER, Role.MERCHANT];

let prisma: PrismaService;
let market: MarketService;
let catalog: CatalogService;
let orders: OrdersService;

const olusanKullanicilar: string[] = [];
let sayac = 0;

async function kullaniciKur(etiket: string, roller: Role[]): Promise<string> {
  sayac += 1;
  const k = await prisma.user.create({
    data: { phone: `V01-${KOSU}-${sayac}-${etiket}`, name: `V01 ${etiket}`, surname: 'Test', status: UserStatus.ACTIVE },
  });
  olusanKullanicilar.push(k.id);
  if (roller.length > 0) {
    await prisma.userRole.createMany({ data: roller.map((role) => ({ userId: k.id, role, storeId: null })) });
  }
  return k.id;
}

async function saticiKur(dikey: BusinessUnit) {
  const sahip = await kullaniciKur(`sahip-${dikey}`, MERCHANT);
  const s = await prisma.seller.create({
    data: {
      ownerUserId: sahip,
      sellerType: SellerType.MARKET,
      legalName: `V01 Unvan ${KOSU}`,
      displayName: `V01 Ad ${KOSU}`,
      talepEdilenDikey: dikey,
      status: SellerStatus.ACTIVE,
      verification: SellerVerification.ONAYLANDI,
    },
  });
  return { sellerId: s.id, sahip };
}

type Kaynak = { dikey: BusinessUnit; sahip: string; sellerId: string; storeId: string; productId: string; orderId: string };
const K: Partial<Record<BusinessUnit, Kaynak>> = {};
let musteri: string;
let admin: string;
let superAdmin: string;

/** GERCEK ilk magaza kurulumu (baslik yok, muaf) + urun + CONFIRMED siparis. */
async function dikeyKaynagiKur(dikey: BusinessUnit): Promise<Kaynak> {
  const { sellerId, sahip } = await saticiKur(dikey);
  const magaza = await market.create(sahip, { name: `V01 ${KOSU} ${dikey}` }, '10.0.1.1');
  const urun = await prisma.product.create({
    data: { storeId: magaza.id, name: `V01 urun ${dikey}`, slug: `v01-${KOSU}-${dikey.toLowerCase()}`, price: 1000n },
  });
  const siparis = await prisma.order.create({
    data: {
      orderNo: `V01-${KOSU}-${dikey}`, userId: musteri, storeId: magaza.id, businessUnit: dikey,
      subtotal: 1000n, total: 1000n, status: OrderStatus.CONFIRMED,
    },
  });
  return { dikey, sahip, sellerId, storeId: magaza.id, productId: urun.id, orderId: siparis.id };
}

const kim = (id: string, roles: Role[]): AuthUser => ({ id, phone: 'x', roles, magazaRolleri: {} });

async function kod(p: Promise<unknown>, sinif: new (...a: any[]) => Error, beklenen: string) {
  const hata = await p.then(() => null, (e) => e);
  expect(hata).toBeInstanceOf(sinif);
  expect((hata.getResponse() as { kod: string }).kod).toBe(beklenen);
}

// ==================================================================== kurulum

beforeAll(async () => {
  const url = testVeritabaniUrl();
  prisma = new PrismaService({ datasources: { db: { url } } });
  await prisma.$connect();
  market = new MarketService(prisma, new AuditService(prisma), new SellerStatusService(), new SozlesmeService(prisma));
  catalog = new CatalogService(prisma, market);
  // updateStatus/getOne/storeOrders ledger, cuzdan ve bildirime dokunmaz.
  orders = new OrdersService(prisma, {} as never, {} as never, new OrderStatusService(), {} as never, market);

  musteri = await kullaniciKur('musteri', [Role.CUSTOMER]);
  admin = await kullaniciKur('admin', [Role.ADMIN]);
  superAdmin = await kullaniciKur('superadmin', [Role.SUPER_ADMIN]);
  for (const d of [MARKET, YEMEK, CARSI]) K[d] = await dikeyKaynagiKur(d);
});

afterAll(async () => {
  if (!prisma) return;
  testVeritabaniUrl(); // DEFENSE IN DEPTH

  if (olusanKullanicilar.length > 0) {
    const saticilar = (await prisma.seller.findMany({ where: { ownerUserId: { in: olusanKullanicilar } }, select: { id: true } }))
      .map((s) => s.id);
    const magazaIdleri = (await prisma.store.findMany({ where: { sellerId: { in: saticilar } }, select: { id: true } }))
      .map((m) => m.id);
    await prisma.order.deleteMany({ where: { storeId: { in: magazaIdleri } } });
    await prisma.product.deleteMany({ where: { storeId: { in: magazaIdleri } } });
    await prisma.auditLog.deleteMany({ where: { entity: 'Store', entityId: { in: magazaIdleri } } });
    await prisma.userRole.deleteMany({ where: { OR: [{ userId: { in: olusanKullanicilar } }, { storeId: { in: magazaIdleri } }] } });
    await prisma.storeUser.deleteMany({ where: { storeId: { in: magazaIdleri } } });
    await prisma.store.deleteMany({ where: { id: { in: magazaIdleri } } });
    await prisma.seller.deleteMany({ where: { id: { in: saticilar } } });
    await prisma.user.deleteMany({ where: { id: { in: olusanKullanicilar } } });
  }
  await prisma.$disconnect();
});

// ===================================================================== testler

describe('VERT-01 — S1/S2/S3 yanlis baglam 403, yazma olmaz', () => {
  it('S1: MARKET baglami -> YEMEK magaza guncelleme = 403 DIKEY_UYUMSUZ (ad degismez)', async () => {
    const y = K[YEMEK]!;
    const once = await prisma.store.findUniqueOrThrow({ where: { id: y.storeId }, select: { name: true } });
    await kod(market.update(y.storeId, y.sahip, MERCHANT, { name: 'SIZMA' }, undefined, MARKET), ForbiddenException, 'DIKEY_UYUMSUZ');
    expect(await prisma.store.findUniqueOrThrow({ where: { id: y.storeId }, select: { name: true } })).toEqual(once);
  });

  it('S2: MARKET baglami -> CARSI urun guncelleme = 403 DIKEY_UYUMSUZ (ad degismez)', async () => {
    const c = K[CARSI]!;
    await kod(catalog.updateProduct(c.productId, c.sahip, MERCHANT, { name: 'SIZMA' } as never, MARKET), ForbiddenException, 'DIKEY_UYUMSUZ');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: c.productId } })).name).toBe(`V01 urun ${CARSI}`);
  });

  it('S3: MARKET baglami -> YEMEK siparis durumu = 403 DIKEY_UYUMSUZ (durum degismez)', async () => {
    const y = K[YEMEK]!;
    await kod(orders.updateStatus(kim(y.sahip, MERCHANT), y.orderId, OrderStatus.PREPARING, MARKET), ForbiddenException, 'DIKEY_UYUMSUZ');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: y.orderId } })).status).toBe(OrderStatus.CONFIRMED);
  });

  it('3x3 matris: her sahip yalniz KENDI dikey baglaminda kendi kaynagina erisir', async () => {
    for (const baglam of [MARKET, YEMEK, CARSI]) {
      for (const hedef of [MARKET, YEMEK, CARSI]) {
        const h = K[hedef]!;
        const cagri = catalog.listPending(h.storeId, h.sahip, MERCHANT, baglam);
        if (baglam === hedef) await expect(cagri).resolves.toBeDefined();
        else await kod(cagri, ForbiddenException, 'DIKEY_UYUMSUZ');
      }
    }
  });
});

describe('VERT-01 — S4/S5/S6 magaza rolu birlesimi', () => {
  // MARKET sahibi (MERCHANT) YEMEK magazasina GERCEK yoldan personel olarak eklenir.
  beforeAll(async () => {
    const y = K[YEMEK]!;
    await market.personelEkle(y.storeId, y.sahip, MERCHANT, K[MARKET]!.sahip, YEMEK);
  });

  it('S4: MARKET baglaminda YEMEK kaynaklarina erisemez (403)', async () => {
    const m = K[MARKET]!;
    const y = K[YEMEK]!;
    await kod(market.update(y.storeId, m.sahip, MERCHANT, { name: 'SIZMA' }, undefined, MARKET), ForbiddenException, 'DIKEY_UYUMSUZ');
    await kod(catalog.updateProduct(y.productId, m.sahip, MERCHANT, { name: 'SIZMA' } as never, MARKET), ForbiddenException, 'DIKEY_UYUMSUZ');
    await kod(orders.updateStatus(kim(m.sahip, MERCHANT), y.orderId, OrderStatus.PREPARING, MARKET), ForbiddenException, 'DIKEY_UYUMSUZ');
  });

  it('S6: dogru YEMEK baglaminda bile MERCHANT platform izni + STORE_STAFF uyeligi yazma URETMEZ', async () => {
    const m = K[MARKET]!;
    const y = K[YEMEK]!;
    await expect(market.update(y.storeId, m.sahip, MERCHANT, { name: 'SIZMA' }, undefined, YEMEK)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(catalog.updateProduct(y.productId, m.sahip, MERCHANT, { name: 'SIZMA' } as never, YEMEK)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(orders.updateStatus(kim(m.sahip, MERCHANT), y.orderId, OrderStatus.PREPARING, YEMEK)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: y.orderId } })).status).toBe(OrderStatus.CONFIRMED);
  });

  it('S5: YEMEK sahibi STORE_KITCHEN verince ayni kisi YEMEK baglaminda siparisi ilerletir', async () => {
    const m = K[MARKET]!;
    const y = K[YEMEK]!;
    await market.rolVer(y.storeId, y.sahip, MERCHANT, m.sahip, Role.STORE_KITCHEN, YEMEK);
    const r = await orders.updateStatus(kim(m.sahip, MERCHANT), y.orderId, OrderStatus.PREPARING, YEMEK);
    expect(r?.status).toBe(OrderStatus.PREPARING);
    // KITCHEN urun yazma izni tasimaz: katalog hala kapali; MARKET baglami hala 403.
    await expect(catalog.updateProduct(y.productId, m.sahip, MERCHANT, { name: 'SIZMA' } as never, YEMEK)).rejects.toBeInstanceOf(ForbiddenException);
    await kod(orders.storeOrders(kim(m.sahip, MERCHANT), y.storeId, MARKET), ForbiddenException, 'DIKEY_UYUMSUZ');
  });

  it('S6: YEMEK magazasindaki KITCHEN rolu baska dikeyin (CARSI) magazasina tasinmaz', async () => {
    const m = K[MARKET]!;
    const c = K[CARSI]!;
    await kod(orders.storeOrders(kim(m.sahip, MERCHANT), c.storeId, YEMEK), ForbiddenException, 'DIKEY_UYUMSUZ');
    await expect(orders.storeOrders(kim(m.sahip, MERCHANT), c.storeId, CARSI)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('VERT-01 — S7 platform yoneticisi', () => {
  it.each([
    ['ADMIN', () => admin, Role.ADMIN],
    ['SUPER_ADMIN', () => superAdmin, Role.SUPER_ADMIN],
  ])('%s baglamsiz ve yanlis baglamda her dikeyin kaynagina erisir', async (_ad, kimlik, rol) => {
    for (const d of [MARKET, YEMEK, CARSI]) {
      const h = K[d]!;
      await expect(catalog.listPending(h.storeId, kimlik(), [rol], null)).resolves.toBeDefined();
      await expect(orders.storeOrders(kim(kimlik(), [rol]), h.storeId, d === MARKET ? YEMEK : MARKET)).resolves.toBeDefined();
      await expect(market.calismaSaatleri(h.storeId, kimlik(), [rol], null)).resolves.toBeDefined();
    }
  });
});

describe('VERT-01 — S8 eksik / gecersiz baglam', () => {
  it('baslik yok (null) -> sahip dahil 400 DIKEY_BAGLAMI_GEREKLI; store/product/order ayni kod', async () => {
    const m = K[MARKET]!;
    await kod(market.update(m.storeId, m.sahip, MERCHANT, { description: 'x' }, undefined, null), BadRequestException, 'DIKEY_BAGLAMI_GEREKLI');
    await kod(catalog.urunDetay(m.productId, m.sahip, MERCHANT, null), BadRequestException, 'DIKEY_BAGLAMI_GEREKLI');
    await kod(orders.storeOrders(kim(m.sahip, MERCHANT), m.storeId, null), BadRequestException, 'DIKEY_BAGLAMI_GEREKLI');
    await kod(market.saticiSiparisleri(m.sahip, MERCHANT, null, {}), BadRequestException, 'DIKEY_BAGLAMI_GEREKLI');
  });
});

describe('VERT-01 — S9 my/stores + bootstrap muafiyeti (cok dikeyli satici)', () => {
  let cok: { sellerId: string; sahip: string; market: string; carsi: string };

  beforeAll(async () => {
    const { sellerId, sahip } = await saticiKur(MARKET);
    const mm = await market.create(sahip, { name: `V01 ${KOSU} cok-M` }, '10.0.1.2'); // ilk magaza: GERCEK yol, basliksiz
    // Ikinci dikeydeki magaza fixture olarak (kurulum ucu ilk magazayla sinirli).
    const mc = await prisma.store.create({
      data: { ownerId: sahip, sellerId, name: `V01 ${KOSU} cok-C`, slug: `v01-${KOSU}-cok-c`, businessUnit: CARSI },
    });
    cok = { sellerId, sahip, market: mm.id, carsi: mc.id };
  });

  it('my/stores MARKET baglami -> yalniz MARKET; CARSI baglami -> yalniz CARSI', async () => {
    const mIds = (await market.myStores(cok.sahip, MERCHANT, MARKET)).map((s) => s.id);
    const cIds = (await market.myStores(cok.sahip, MERCHANT, CARSI)).map((s) => s.id);
    expect(mIds).toEqual([cok.market]);
    expect(cIds).toEqual([cok.carsi]);
    expect(await market.myStores(cok.sahip, MERCHANT, YEMEK)).toEqual([]);
  });

  it('my/stores baglamsiz -> 400', () => {
    expect(() => market.myStores(cok.sahip, MERCHANT, null)).toThrow(BadRequestException);
  });

  it('BOOTSTRAP: GET /market/seller basliksiz calisir ve IKI dikeyi de doner (dikey secimi icin)', async () => {
    const s = await market.saticim(cok.sahip);
    expect(s.stores.map((m: { businessUnit: BusinessUnit }) => m.businessUnit).sort()).toEqual([CARSI, MARKET]);
  });

  it('KYC belgeleri basliksiz okunur (muaf)', async () => {
    await expect(market.belgelerim(cok.sahip)).resolves.toBeDefined();
  });

  it('seller/orders MARKET baglaminda CARSI magazasini kapsamaz', async () => {
    const r = await market.saticiSiparisleri(cok.sahip, MERCHANT, MARKET, {});
    expect(r.dikey).toBe(MARKET);
    expect(r.magazalar.map((m: { id: string }) => m.id)).toEqual([cok.market]);
  });

  it('cok dikeyli sahip her magazasini YALNIZ kendi dikey baglaminda yonetir', async () => {
    await expect(market.calismaSaatleri(cok.carsi, cok.sahip, MERCHANT, CARSI)).resolves.toBeDefined();
    await kod(market.calismaSaatleri(cok.carsi, cok.sahip, MERCHANT, MARKET), ForbiddenException, 'DIKEY_UYUMSUZ');
  });
});

describe('VERT-01 — basvuru ve ilk magaza muafiyeti', () => {
  it('BASVURU: yeni kullanici basliksiz DRAFT satici basvurusu acar', async () => {
    const yeni = await kullaniciKur('basvuru', [Role.CUSTOMER]);
    const s = await market.saticiOlustur(yeni, {
      sellerType: SellerType.MARKET, legalName: `V01 B ${KOSU}`, displayName: `V01 B ${KOSU}`, talepEdilenDikey: YEMEK,
      yetkiliAdSoyad: 'V01 Yetkili', basvuruEposta: `v01-${KOSU}@example.test`,
    } as never);
    expect(s.status).toBe(SellerStatus.DRAFT);
  });

  it('ILK MAGAZA: dikey Seller.talepEdilenDikey\'den gelir, baslik gerekmez', async () => {
    const { sahip } = await saticiKur(CARSI);
    const magaza = await market.create(sahip, { name: `V01 ${KOSU} ilk` }, '10.0.1.3');
    expect(magaza.businessUnit).toBe(CARSI);
  });
});

describe('VERT-01 — S10 tek dikeyli satici regresyonu', () => {
  it('MARKET saticisi MARKET baglaminda magaza/urun/siparis akisini surdurur', async () => {
    const m = K[MARKET]!;
    await expect(market.update(m.storeId, m.sahip, MERCHANT, { description: 'guncel' }, undefined, MARKET)).resolves.toMatchObject({ description: 'guncel' });
    await expect(market.calismaSaatleri(m.storeId, m.sahip, MERCHANT, MARKET)).resolves.toBeDefined();
    await expect(catalog.urunDetay(m.productId, m.sahip, MERCHANT, MARKET)).resolves.toMatchObject({ id: m.productId });
    await expect(catalog.updateProduct(m.productId, m.sahip, MERCHANT, { name: 'V01 yeni ad' } as never, MARKET)).resolves.toMatchObject({ name: 'V01 yeni ad' });
    await expect(orders.storeOrders(kim(m.sahip, MERCHANT), m.storeId, MARKET)).resolves.toHaveLength(1);
    await expect(orders.getOne(kim(m.sahip, MERCHANT), m.orderId, MARKET)).resolves.toMatchObject({ id: m.orderId });
    const r = await orders.updateStatus(kim(m.sahip, MERCHANT), m.orderId, OrderStatus.PREPARING, MARKET);
    expect(r?.status).toBe(OrderStatus.PREPARING);
    expect((await market.myStores(m.sahip, MERCHANT, MARKET)).map((s) => s.id)).toEqual([m.storeId]);
  });

  it('MUSTERI kendi siparisini basliksiz gorur (muaf)', async () => {
    const c = K[CARSI]!;
    await expect(orders.getOne(kim(musteri, [Role.CUSTOMER]), c.orderId, null)).resolves.toMatchObject({ id: c.orderId });
  });
});
