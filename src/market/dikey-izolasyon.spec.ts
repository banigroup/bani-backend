// VERT-01 / P1 — DIKEY VE HEDEF MAGAZA IZOLASYONU (birim, DB YOK).
//
// NE KANITLIYOR:
//   · X-Bani-Dikey cozumu (yalniz baslik; eksik/gecersiz -> null);
//   · merkezi kapi MarketService.erisebilir: platform yoneticisi muaf; digerleri
//     icin eksik baglam 400 DIKEY_BAGLAMI_GEREKLI, uyusmazlik 403 DIKEY_UYUMSUZ;
//   · uyelik yolunda izin YALNIZ hedef magazadaki rollerden gelir (birlesim acigi);
//   · my/stores ve seller/orders aktif dikeye suzulur;
//   · Store / Product / Order yollari kapidan dikeyle gecer; musteri yolu muaf;
//   · dikey bagli uclar ile BILEREK muaf uclar controller metadata'sinda kilitli.
//
// Gercek PostgreSQL ile ayni senaryolar: dikey-izolasyon.int.spec.ts.
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { BusinessUnit, OrderStatus, Role } from '@prisma/client';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';
import { SellerStatusService } from './seller-status.service';
import { AuditService } from '../common/audit/audit.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from '../catalog/catalog.service';
import { CatalogController } from '../catalog/catalog.controller';
import { OrdersService } from '../orders/orders.service';
import { OrdersController } from '../orders/orders.controller';
import { Permission } from '../common/rbac/permissions.enum';
import { istekDikeyiCoz } from '../common/decorators/current-user.decorator';

const { MARKET, YEMEK, CARSI } = BusinessUnit;

// Kimlikler
const SAHIP_M = 'a0000000-0000-4000-8000-000000000001'; // MARKET magazasinin sahibi (MERCHANT)
const SAHIP_Y = 'a0000000-0000-4000-8000-000000000002'; // YEMEK magazasinin sahibi
const SAHIP_C = 'a0000000-0000-4000-8000-000000000003'; // CARSI magazasinin sahibi
const MUSTERI = 'a0000000-0000-4000-8000-000000000009';

const MAGAZA_M = 'b0000000-0000-4000-8000-00000000000a';
const MAGAZA_Y = 'b0000000-0000-4000-8000-00000000000b';
const MAGAZA_C = 'b0000000-0000-4000-8000-00000000000c';
const MAGAZA_M2 = 'b0000000-0000-4000-8000-00000000000d'; // ayni sahibin (SAHIP_M) ikinci MARKET magazasi

const magazalar: Record<string, { id: string; ownerId: string; businessUnit: BusinessUnit; deletedAt: null }> = {
  [MAGAZA_M]: { id: MAGAZA_M, ownerId: SAHIP_M, businessUnit: MARKET, deletedAt: null },
  [MAGAZA_M2]: { id: MAGAZA_M2, ownerId: SAHIP_M, businessUnit: MARKET, deletedAt: null },
  [MAGAZA_Y]: { id: MAGAZA_Y, ownerId: SAHIP_Y, businessUnit: YEMEK, deletedAt: null },
  [MAGAZA_C]: { id: MAGAZA_C, ownerId: SAHIP_C, businessUnit: CARSI, deletedAt: null },
};

// Canli matrisin magaza rolleri kismi (20260821110001_faz1_b1_magaza_izinleri).
const MAGAZA_MATRISI: Partial<Record<Role, string[]>> = {
  [Role.STORE_STAFF]: [],
  [Role.STORE_KITCHEN]: ['order:manage'],
  [Role.STORE_CASHIER]: ['order:manage'],
  [Role.STORE_STOCK]: ['product:write'],
};

const MERCHANT = [Role.CUSTOMER, Role.MERCHANT];

function kur(magazaRolSatirlari: { userId: string; storeId: string; role: Role }[] = []) {
  const prisma = {
    store: {
      findFirst: jest.fn(async ({ where }: any) => magazalar[where.id] ?? null),
      findUnique: jest.fn(async ({ where }: any) => magazalar[where.id] ?? null),
      findMany: jest.fn(async (_args: any) => []),
    },
    userRole: {
      findFirst: jest.fn(async ({ where }: any) =>
        magazaRolSatirlari.find((r) => r.userId === where.userId && r.storeId === where.storeId) ?? null),
      findMany: jest.fn(async ({ where }: any) =>
        magazaRolSatirlari.filter((r) => r.userId === where.userId && r.storeId === where.storeId)),
    },
    rolePermission: {
      findFirst: jest.fn(async ({ where }: any) =>
        (where.role.in as Role[]).some((r) => (MAGAZA_MATRISI[r] ?? []).includes(where.permissionKey)) ? { id: 'x' } : null),
    },
    seller: { findFirst: jest.fn(async () => ({ id: 'seller-1', ownerUserId: SAHIP_M })) },
    product: {
      findFirst: jest.fn(async ({ where }: any) => ({ id: where.id, storeId: urunMagazasi[where.id], deletedAt: null })),
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
    },
    order: {
      findUnique: jest.fn(async ({ where }: any) => siparisler[where.id] ?? null),
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(prisma)),
  };
  const market = new MarketService(
    prisma as unknown as PrismaService,
    { record: jest.fn() } as unknown as AuditService,
    new SellerStatusService(),
    {} as unknown as SozlesmeService,
  );
  const catalog = new CatalogService(prisma as unknown as PrismaService, market);
  const orders = new OrdersService(
    prisma as unknown as PrismaService,
    {} as never,
    {} as never,
    { NEXT_STATUS: { PENDING: [OrderStatus.CONFIRMED] }, CANCELABLE: [] } as never,
    {} as never,
    market,
  );
  return { prisma, market, catalog, orders };
}

const URUN_M = 'c0000000-0000-4000-8000-00000000000a';
const URUN_C = 'c0000000-0000-4000-8000-00000000000c';
const urunMagazasi: Record<string, string> = { [URUN_M]: MAGAZA_M, [URUN_C]: MAGAZA_C };

const SIPARIS_Y = 'd0000000-0000-4000-8000-00000000000b';
const SIPARIS_M = 'd0000000-0000-4000-8000-00000000000a';
const siparisler: Record<string, any> = {
  [SIPARIS_Y]: { id: SIPARIS_Y, userId: MUSTERI, status: OrderStatus.PENDING, store: magazalar[MAGAZA_Y], items: [], delivery: null },
  [SIPARIS_M]: { id: SIPARIS_M, userId: MUSTERI, status: OrderStatus.PENDING, store: magazalar[MAGAZA_M], items: [], delivery: null },
};

const kullanici = (id: string, roles: Role[]) => ({ id, phone: 'x', roles, magazaRolleri: {} });

async function kodu(p: Promise<unknown>, sinif: new (...a: any[]) => Error, kod: string) {
  const hata = await p.then(() => null, (e) => e);
  expect(hata).toBeInstanceOf(sinif);
  expect((hata.getResponse() as { kod: string }).kod).toBe(kod);
}

// ============================================================ baglam cozumu

describe('VERT-01 — X-Bani-Dikey cozumu', () => {
  const ctx = (headers: Record<string, unknown>) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as any;

  it.each([
    ['MARKET', MARKET],
    ['yemek', YEMEK],
    [' CARSI ', CARSI],
  ])('%s -> %s', (deger, beklenen) => {
    expect(istekDikeyiCoz(undefined, ctx({ 'x-bani-dikey': deger }))).toBe(beklenen);
  });

  it.each([
    ['yok', {}],
    ['bos', { 'x-bani-dikey': '' }],
    ['gecersiz', { 'x-bani-dikey': 'KAHVE' }],
    ['tekrarli (dizi)', { 'x-bani-dikey': ['MARKET', 'YEMEK'] }],
  ])('%s -> null', (_ad, headers) => {
    expect(istekDikeyiCoz(undefined, ctx(headers))).toBeNull();
  });

  it('Origin OKUNMAZ: markali origin baslik yerine gecmez', () => {
    expect(istekDikeyiCoz(undefined, ctx({ origin: 'https://banimarket.com.tr' }))).toBeNull();
  });
});

// ============================================================ merkezi kapi

describe('VERT-01 — merkezi kapi (erisebilir)', () => {
  it('sahip + dogru dikey -> gecer', async () => {
    const { market } = kur();
    await expect(market.erisebilir(magazalar[MAGAZA_M], SAHIP_M, MERCHANT, MARKET, Permission.STORE_WRITE)).resolves.toBe(true);
  });

  it('sahip bile olsa baglam YOK -> 400 DIKEY_BAGLAMI_GEREKLI (fallback yok)', async () => {
    const { market } = kur();
    await kodu(market.erisebilir(magazalar[MAGAZA_M], SAHIP_M, MERCHANT, null, Permission.STORE_WRITE), BadRequestException, 'DIKEY_BAGLAMI_GEREKLI');
  });

  it('sahip bile olsa YANLIS dikey -> 403 DIKEY_UYUMSUZ', async () => {
    const { market } = kur();
    await kodu(market.erisebilir(magazalar[MAGAZA_M], SAHIP_M, MERCHANT, YEMEK, Permission.STORE_WRITE), ForbiddenException, 'DIKEY_UYUMSUZ');
  });

  it.each([Role.ADMIN, Role.SUPER_ADMIN])('%s: baglamsiz ve yanlis baglamda gecer, uyelik sorgusu ACILMAZ', async (rol) => {
    const { market, prisma } = kur();
    await expect(market.erisebilir(magazalar[MAGAZA_Y], 'admin', [rol], null, Permission.ORDER_MANAGE)).resolves.toBe(true);
    await expect(market.erisebilir(magazalar[MAGAZA_Y], 'admin', [rol], MARKET, Permission.ORDER_MANAGE)).resolves.toBe(true);
    expect(prisma.userRole.findMany).not.toHaveBeenCalled();
  });

  it('BIRLESIM U1: MARKET sahibi (MERCHANT) + YEMEK STORE_STAFF -> dogru YEMEK baglaminda bile yazamaz', async () => {
    const { market } = kur([{ userId: SAHIP_M, storeId: MAGAZA_Y, role: Role.STORE_STAFF }]);
    for (const izin of [Permission.PRODUCT_WRITE, Permission.ORDER_MANAGE, Permission.STORE_WRITE]) {
      await expect(market.erisebilir(magazalar[MAGAZA_Y], SAHIP_M, MERCHANT, YEMEK, izin)).resolves.toBe(false);
    }
  });

  it('BIRLESIM U2: X magazasinda STORE_KITCHEN, Y magazasinda STORE_STAFF -> Y siparisini yonetemez', async () => {
    const PERSONEL = 'e0000000-0000-4000-8000-000000000001';
    const { market, prisma } = kur([
      { userId: PERSONEL, storeId: MAGAZA_M2, role: Role.STORE_KITCHEN },
      { userId: PERSONEL, storeId: MAGAZA_M, role: Role.STORE_STAFF },
    ]);
    await expect(market.erisebilir(magazalar[MAGAZA_M], PERSONEL, [Role.CUSTOMER], MARKET, Permission.ORDER_MANAGE)).resolves.toBe(false);
    // Rol okumasi HEDEF magazayla sinirli: baska magazanin satiri sorguya giremez.
    expect(prisma.userRole.findMany).toHaveBeenCalledWith({ where: { userId: PERSONEL, storeId: MAGAZA_M }, select: { role: true } });
    // Ayni kisi KITCHEN oldugu magazada yonetebilir.
    await expect(market.erisebilir(magazalar[MAGAZA_M2], PERSONEL, [Role.CUSTOMER], MARKET, Permission.ORDER_MANAGE)).resolves.toBe(true);
  });

  it('beyaz liste disi izin (store:write) uyelik yolundan HIC gecmez, sorgu acilmaz', async () => {
    const PERSONEL = 'e0000000-0000-4000-8000-000000000002';
    const { market, prisma } = kur([{ userId: PERSONEL, storeId: MAGAZA_M, role: Role.STORE_STOCK }]);
    await expect(market.erisebilir(magazalar[MAGAZA_M], PERSONEL, [Role.CUSTOMER], MARKET, Permission.STORE_WRITE)).resolves.toBe(false);
    expect(prisma.userRole.findMany).not.toHaveBeenCalled();
  });

  it('izin null (okuma): uyelik yeter - onceki davranis', async () => {
    const PERSONEL = 'e0000000-0000-4000-8000-000000000003';
    const { market } = kur([{ userId: PERSONEL, storeId: MAGAZA_M, role: Role.STORE_STAFF }]);
    await expect(market.erisebilir(magazalar[MAGAZA_M], PERSONEL, [Role.CUSTOMER], MARKET, null)).resolves.toBe(true);
    await kodu(market.erisebilir(magazalar[MAGAZA_M], PERSONEL, [Role.CUSTOMER], YEMEK, null), ForbiddenException, 'DIKEY_UYUMSUZ');
  });
});

// ============================================================ STORE

describe('VERT-01 — Store yollari', () => {
  it('S1: MARKET baglami -> YEMEK magazasi guncelleme = 403 DIKEY_UYUMSUZ', async () => {
    const { market, prisma } = kur();
    await kodu(market.update(MAGAZA_Y, SAHIP_Y, MERCHANT, {} as any, undefined, MARKET), ForbiddenException, 'DIKEY_UYUMSUZ');
    expect(prisma.store.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['logoImzasi', (m: MarketService, d: BusinessUnit | null) => m.logoImzasi(MAGAZA_Y, SAHIP_Y, MERCHANT, d)],
    ['calismaSaatleri', (m: MarketService, d: BusinessUnit | null) => m.calismaSaatleri(MAGAZA_Y, SAHIP_Y, MERCHANT, d)],
    ['teslimatBolgeleri', (m: MarketService, d: BusinessUnit | null) => m.teslimatBolgeleri(MAGAZA_Y, SAHIP_Y, MERCHANT, d)],
    ['personelListesi', (m: MarketService, d: BusinessUnit | null) => m.personelListesi(MAGAZA_Y, SAHIP_Y, MERCHANT, d)],
    ['personelEkle', (m: MarketService, d: BusinessUnit | null) => m.personelEkle(MAGAZA_Y, SAHIP_Y, MERCHANT, 'u', d)],
    ['personelDurum', (m: MarketService, d: BusinessUnit | null) => m.personelDurum(MAGAZA_Y, SAHIP_Y, MERCHANT, 'u', false, d)],
    ['rolVer', (m: MarketService, d: BusinessUnit | null) => m.rolVer(MAGAZA_Y, SAHIP_Y, MERCHANT, 'u', 'STORE_KITCHEN', d)],
    ['rolAl', (m: MarketService, d: BusinessUnit | null) => m.rolAl(MAGAZA_Y, SAHIP_Y, MERCHANT, 'u', 'STORE_KITCHEN', d)],
  ])('%s: kendi YEMEK magazasi, baglamsiz = 400 / MARKET baglami = 403', async (_ad, cagri) => {
    const { market } = kur();
    await kodu(cagri(market, null), BadRequestException, 'DIKEY_BAGLAMI_GEREKLI');
    await kodu(cagri(market, MARKET), ForbiddenException, 'DIKEY_UYUMSUZ');
  });

  it('personel yonetimi: platform yoneticisi baglamsiz gecer (kapi asamasi)', async () => {
    const { market, prisma } = kur();
    (prisma as any).storeUser = { findMany: jest.fn(async () => []) };
    await expect(market.personelListesi(MAGAZA_Y, 'admin', [Role.ADMIN], null)).resolves.toEqual([]);
  });
});

// ============================================================ my/stores + seller/orders

describe('VERT-01 — liste uclari aktif dikeye suzulur', () => {
  it('S9: my/stores yalniz aktif dikey (businessUnit suzgeci)', async () => {
    const { market, prisma } = kur();
    await market.myStores(SAHIP_M, MERCHANT, CARSI);
    expect(prisma.store.findMany.mock.calls[0][0].where.businessUnit).toBe(CARSI);
  });

  it('my/stores baglamsiz -> 400 (satici)', () => {
    const { market } = kur();
    expect(() => market.myStores(SAHIP_M, MERCHANT, null)).toThrow(BadRequestException);
  });

  it('my/stores platform yoneticisi baglamsiz -> suzgecsiz (mevcut davranis)', async () => {
    const { market, prisma } = kur();
    await market.myStores('admin', [Role.ADMIN], null);
    expect(prisma.store.findMany.mock.calls[0][0].where).not.toHaveProperty('businessUnit');
  });

  it('seller/orders: baglamsiz 400, q.dikey baglamla celisirse 403, baglam suzgece yazilir', async () => {
    const { market, prisma } = kur();
    await kodu(market.saticiSiparisleri(SAHIP_M, MERCHANT, null, {}), BadRequestException, 'DIKEY_BAGLAMI_GEREKLI');
    await kodu(market.saticiSiparisleri(SAHIP_M, MERCHANT, MARKET, { dikey: YEMEK }), ForbiddenException, 'DIKEY_UYUMSUZ');
    const r = await market.saticiSiparisleri(SAHIP_M, MERCHANT, MARKET, {});
    expect(prisma.store.findMany.mock.calls.at(-1)![0].where.businessUnit).toBe(MARKET);
    expect(r.dikey).toBe(MARKET);
  });
});

// ============================================================ PRODUCT

describe('VERT-01 — Product yollari', () => {
  it('S2: MARKET baglami -> CARSI urunu guncelleme/silme = 403, yazma YOK', async () => {
    const { catalog, prisma } = kur();
    await kodu(catalog.updateProduct(URUN_C, SAHIP_C, MERCHANT, {} as any, MARKET), ForbiddenException, 'DIKEY_UYUMSUZ');
    await kodu(catalog.removeProduct(URUN_C, SAHIP_C, MERCHANT, MARKET), ForbiddenException, 'DIKEY_UYUMSUZ');
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('dogru CARSI baglaminda sahip urunu silebilir', async () => {
    const { catalog, prisma } = kur();
    await expect(catalog.removeProduct(URUN_C, SAHIP_C, MERCHANT, CARSI)).resolves.toEqual({ deleted: true });
    expect(prisma.product.update).toHaveBeenCalledTimes(1);
  });

  it('baglamsiz katalog yazma -> 400', async () => {
    const { catalog } = kur();
    await kodu(catalog.listPending(MAGAZA_M, SAHIP_M, MERCHANT, null), BadRequestException, 'DIKEY_BAGLAMI_GEREKLI');
  });

  it('STORE_STOCK (product:write) kendi magazasinda yazar, STORE_KITCHEN yazamaz', async () => {
    const STOK = 'e0000000-0000-4000-8000-000000000011';
    const MUTFAK = 'e0000000-0000-4000-8000-000000000012';
    const { catalog } = kur([
      { userId: STOK, storeId: MAGAZA_M, role: Role.STORE_STOCK },
      { userId: MUTFAK, storeId: MAGAZA_M, role: Role.STORE_KITCHEN },
    ]);
    await expect(catalog.listPending(MAGAZA_M, STOK, [Role.CUSTOMER], MARKET)).resolves.toEqual([]);
    await expect(catalog.listPending(MAGAZA_M, MUTFAK, [Role.CUSTOMER], MARKET)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

// ============================================================ ORDER

describe('VERT-01 — Order yollari', () => {
  it('S3: MARKET baglami -> YEMEK siparis durumu = 403, yazma YOK', async () => {
    const { orders, prisma } = kur();
    await kodu(orders.updateStatus(kullanici(SAHIP_Y, MERCHANT), SIPARIS_Y, OrderStatus.CONFIRMED, MARKET), ForbiddenException, 'DIKEY_UYUMSUZ');
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('S5: YEMEK baglaminda YEMEK STORE_KITCHEN siparis durumunu ilerletir', async () => {
    const MUTFAK = 'e0000000-0000-4000-8000-000000000021';
    const { orders, prisma } = kur([{ userId: MUTFAK, storeId: MAGAZA_Y, role: Role.STORE_KITCHEN }]);
    await orders.updateStatus(kullanici(MUTFAK, [Role.CUSTOMER]), SIPARIS_Y, OrderStatus.CONFIRMED, YEMEK);
    expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
  });

  it('S7: ADMIN baglamsiz baska dikeyin siparisini ilerletir', async () => {
    const { orders, prisma } = kur();
    await orders.updateStatus(kullanici('admin', [Role.ADMIN]), SIPARIS_Y, OrderStatus.CONFIRMED, null);
    expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
  });

  it('store/:storeId baglamsiz -> 400', async () => {
    const { orders } = kur();
    await kodu(orders.storeOrders(kullanici(SAHIP_M, MERCHANT), MAGAZA_M, null), BadRequestException, 'DIKEY_BAGLAMI_GEREKLI');
  });

  it('MUSTERI kendi siparisini basliksiz gorur ve iptal yoluna girer (muaf)', async () => {
    const { orders } = kur();
    await expect(orders.getOne(kullanici(MUSTERI, [Role.CUSTOMER]), SIPARIS_M, null)).resolves.toMatchObject({ id: SIPARIS_M });
    // CANCELABLE bos: kapidan GECTIGINI 409 kanitlar (400/403 degil).
    await expect(orders.cancel(kullanici(MUSTERI, [Role.CUSTOMER]), SIPARIS_M, null)).rejects.toBeInstanceOf(ConflictException);
  });

  it('magaza tarafi iptal: baglamsiz 400, yanlis dikey 403', async () => {
    const { orders } = kur();
    await kodu(orders.cancel(kullanici(SAHIP_M, MERCHANT), SIPARIS_M, null), BadRequestException, 'DIKEY_BAGLAMI_GEREKLI');
    await kodu(orders.cancel(kullanici(SAHIP_M, MERCHANT), SIPARIS_M, CARSI), ForbiddenException, 'DIKEY_UYUMSUZ');
  });
});

// ============================================================ uc haritasi

/** Handler IstekDikeyi parametresi tasiyor mu (metadata'dan). */
function dikeyBagli(sinif: any, metot: string): boolean {
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, sinif, metot) ?? {};
  return Object.values(meta).some((a: any) => a.factory === istekDikeyiCoz);
}

describe('VERT-01 — dikey bagli / muaf uc haritasi (metadata kilidi)', () => {
  const BAGLI: [any, string[]][] = [
    [MarketController, [
      'mine', 'update', 'logoImza', 'calismaSaatleri', 'calismaSaatleriGuncelle', 'teslimatBolgeleri',
      'teslimatBolgeleriGuncelle', 'saticiSiparisleri', 'personelListesi', 'personelEkle', 'personelDurum', 'rolVer', 'rolAl',
      'panelMagaza',
    ]],
    [CatalogController, [
      'urunDetay', 'pending', 'createCategory', 'medyaImza', 'createProduct', 'updateProduct', 'removeProduct',
      'varyantListesi', 'varyantOlustur', 'varyantGuncelle', 'varyantSil', 'secenekGruplari', 'secenekGrubuOlustur',
      'secenekGrubuGuncelle', 'secenekGrubuSil', 'secenekEkle', 'secenekGuncelle', 'secenekSil', 'urunSecenekGruplari',
      'medyaListesi', 'medyaEkle', 'medyaGuncelle', 'medyaSil',
      'yonetimUrunleri', 'yonetimKategorileri',
    ]],
    [OrdersController, ['storeOrders', 'getOne', 'updateStatus', 'cancel']],
  ];
  // Bootstrap, basvuru, KYC, sozlesme, ilk magaza, vitrin ve admin: YAPISAL OLARAK DIKEYSIZ.
  const MUAF: [any, string[]][] = [
    [MarketController, [
      'saticim', 'saticiOlustur', 'saticiGuncelle', 'saticiOnayaGonder', 'belgeYukle', 'belgelerim',
      'saticiSozlesmeDurum', 'saticiSozlesmeOnayla', 'create', 'list', 'getById', 'getBySlug', 'aktifBolgeler',
      'saticiListesi', 'saticiDetay', 'saticiDurum', 'saticiKarar', 'saticiOnayla', 'saticiDogrulama',
      'bekleyenBelgeler', 'belgeOnayla', 'belgeReddet',
    ]],
    [CatalogController, ['categories', 'products', 'product', 'approve', 'reject']],
    [OrdersController, ['checkout', 'myOrders']],
  ];

  for (const [sinif, metotlar] of BAGLI) {
    it.each(metotlar)(`${sinif.name}.%s dikey bagli`, (m) => expect(dikeyBagli(sinif, m)).toBe(true));
  }
  for (const [sinif, metotlar] of MUAF) {
    it.each(metotlar)(`${sinif.name}.%s MUAF`, (m) => {
      expect(typeof sinif.prototype[m]).toBe('function');
      expect(dikeyBagli(sinif, m)).toBe(false);
    });
  }

  it('haritada olmayan uc YOK (yeni uc eklenince burasi karar ister)', () => {
    for (const sinif of [MarketController, CatalogController, OrdersController]) {
      const tum = Object.getOwnPropertyNames(sinif.prototype).filter((m) => m !== 'constructor');
      const bilinen = [...BAGLI, ...MUAF].filter(([s]) => s === sinif).flatMap(([, ms]) => ms);
      expect(tum.filter((m) => !bilinen.includes(m))).toEqual([]);
    }
  });
});
