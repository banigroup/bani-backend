// VERT-02 / P1 — PUBLIC VITRIN IZOLASYONU (birim, DB YOK).
//
// NE KANITLIYOR:
//   · ?dikey= cozumu: yok -> null (yalniz dikey suzmesi atlanir), gecersiz /
//     bos / tekrarli -> 400 DIKEY_GECERSIZ;
//   · musteri magaza sarti: aktif + silinmemis + satici ACTIVE + (varsa) dikey
//     + en az bir aktif/onayli urun; stok sart DEGIL; dikeysiz istekte de
//     aktiflik ve urun varligi suzulur;
//   · katalog public okumalari magaza sartini (ve varsa dikeyi) tasir;
//   · gorunmeyen / yanlis dikey magaza 404;
//   · satici paneli ucu: sahip gorur, baska satici 403, VERT-01 kapisi korunur;
//   · satici yonetim urun listesi / kategori agaci: vitrin sarti yok, kapi
//     PRODUCT_WRITE + assertOwner + dikey, onbellek yok;
//   · IC getById sorgusu degismedi;
//   · URL-anahtarli onbellek: farkli ?dikey= degerleri ayri anahtar.
//
// Gercek PostgreSQL ile ayni senaryolar: vitrin-dikey.int.spec.ts.
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { ExpressAdapter } from '@nestjs/platform-express';
import { CacheInterceptor } from '@nestjs/cache-manager';
import { caching } from 'cache-manager';
import { lastValueFrom, from } from 'rxjs';
import { BusinessUnit, Role, SellerStatus } from '@prisma/client';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';
import { SellerStatusService } from './seller-status.service';
import { AuditService } from '../common/audit/audit.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { PrismaService } from '../prisma/prisma.service';
import { OnbellekService } from '../common/cache/onbellek.service';
import { CatalogService } from '../catalog/catalog.service';
import { CatalogController } from '../catalog/catalog.controller';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { Permission } from '../common/rbac/permissions.enum';
import { PERMISSIONS_KEY } from '../common/rbac/permissions.decorator';

const { MARKET, YEMEK } = BusinessUnit;
const MERCHANT = [Role.CUSTOMER, Role.MERCHANT];

const SAHIP = 'a0000000-0000-4000-8000-000000000001';
const BASKA = 'a0000000-0000-4000-8000-000000000002';
const MAGAZA = 'b0000000-0000-4000-8000-00000000000a';
const magaza = { id: MAGAZA, ownerId: SAHIP, businessUnit: MARKET, isActive: false, deletedAt: null };

function kur(bulunan: unknown = magaza) {
  const prisma = {
    store: {
      findFirst: jest.fn(async (_a: any) => bulunan),
      findMany: jest.fn(async (_a: any): Promise<unknown[]> => []),
    },
    product: {
      findFirst: jest.fn(async (_a: any) => null),
      findMany: jest.fn(async (_a: any) => []),
    },
    category: { findMany: jest.fn(async (_a: any) => []) },
    userRole: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
  };
  const market = new MarketService(
    prisma as unknown as PrismaService,
    { record: jest.fn() } as unknown as AuditService,
    new SellerStatusService(),
    {} as unknown as SozlesmeService,
  );
  const catalog = new CatalogService(prisma as unknown as PrismaService, market);
  return { prisma, market, catalog };
}

async function kodu(p: Promise<unknown>, sinif: new (...a: any[]) => Error, kod?: string) {
  const hata = await p.then(() => null, (e) => e);
  expect(hata).toBeInstanceOf(sinif);
  if (kod) expect((hata.getResponse() as { kod: string }).kod).toBe(kod);
}

const MAGAZA_SARTI = { isActive: true, deletedAt: null, seller: { status: SellerStatus.ACTIVE } };
const URUN_VARLIGI = { products: { some: { isActive: true, deletedAt: null } } };

// ============================================================ ?dikey= cozumu

describe('VERT-02 — ?dikey= cozumu', () => {
  const { market } = kur();

  it('parametre yok -> null (yalniz dikey suzmesi atlanir)', () => {
    expect(market.vitrinDikeyi(undefined)).toBeNull();
  });

  it.each([['MARKET', MARKET], ['yemek', YEMEK], [' market ', MARKET]])('%s -> %s', (ham, beklenen) => {
    expect(market.vitrinDikeyi(ham)).toBe(beklenen);
  });

  it.each([
    ['gecersiz', 'KAHVE'],
    ['bos', ''],
    ['tekrarli (dizi)', ['MARKET', 'YEMEK']],
  ])('%s -> 400 DIKEY_GECERSIZ', (_ad, ham) => {
    let hata: any;
    try { market.vitrinDikeyi(ham); } catch (e) { hata = e; }
    expect(hata).toBeInstanceOf(BadRequestException);
    expect(hata.getResponse().kod).toBe('DIKEY_GECERSIZ');
  });
});

// ============================================================ magaza gorunurlugu

describe('VERT-02 — musteri magaza sarti', () => {
  it('dikeysiz liste: aktiflik + satici ACTIVE + urun varligi YINE suzulur, dikey suzmesi yok', async () => {
    const { market, prisma } = kur();
    await market.listActive(0, 50, null);
    const where = prisma.store.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ ...MAGAZA_SARTI, ...URUN_VARLIGI });
    expect(where).not.toHaveProperty('businessUnit');
  });

  it('dikeyli liste: businessUnit sarti eklenir', async () => {
    const { market, prisma } = kur();
    await market.listActive(0, 50, YEMEK);
    expect(prisma.store.findMany.mock.calls[0][0].where).toEqual({ ...MAGAZA_SARTI, businessUnit: YEMEK, ...URUN_VARLIGI });
  });

  it('stok sart DEGIL: urun varligi sartinda stock alani yok', async () => {
    const { market, prisma } = kur();
    await market.listActive(0, 50, null);
    expect(JSON.stringify(prisma.store.findMany.mock.calls[0][0].where)).not.toContain('stock');
  });

  it('getPublicById: ayni sartla okur; bulunamazsa (kapali/urunsuz/yanlis dikey) 404', async () => {
    const { market, prisma } = kur(null);
    await kodu(market.getPublicById(MAGAZA, YEMEK), NotFoundException);
    expect(prisma.store.findFirst.mock.calls[0][0].where).toEqual({ id: MAGAZA, ...MAGAZA_SARTI, businessUnit: YEMEK, ...URUN_VARLIGI });
  });

  it('getBySlug: ayni sartla okur; dikeysizde de aktiflik/urun sarti var', async () => {
    const { market, prisma } = kur(null);
    await kodu(market.getBySlug('m', null), NotFoundException);
    expect(prisma.store.findFirst.mock.calls[0][0].where).toEqual({ slug: 'm', ...MAGAZA_SARTI, ...URUN_VARLIGI });
  });
});

// ============================================================ katalog public okumalari

describe('VERT-02 — katalog public okumalari', () => {
  it('getPublicProduct: urunun magazasi vitrin sartini ve dikeyi tasir; yoksa 404', async () => {
    const { catalog, prisma } = kur();
    await kodu(catalog.getPublicProduct('p', YEMEK), NotFoundException);
    expect(prisma.product.findFirst.mock.calls[0][0].where).toEqual({
      id: 'p', isActive: true, deletedAt: null, store: { ...MAGAZA_SARTI, businessUnit: YEMEK },
    });
  });

  it('listProducts / listCategories: magaza gorunmezse 404, urun/kategori sorgusu ACILMAZ', async () => {
    const { catalog, prisma } = kur(null);
    await kodu(catalog.listProducts(MAGAZA, undefined, 0, 50, MARKET), NotFoundException);
    await kodu(catalog.listCategories(MAGAZA, true, null), NotFoundException);
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.category.findMany).not.toHaveBeenCalled();
    expect(prisma.store.findFirst.mock.calls[0][0].where).toEqual({ id: MAGAZA, ...MAGAZA_SARTI, businessUnit: MARKET });
    expect(prisma.store.findFirst.mock.calls[1][0].where).toEqual({ id: MAGAZA, ...MAGAZA_SARTI });
  });

  it('listProducts: urun sorgusu da magaza sartini tasir', async () => {
    const { catalog, prisma } = kur({ id: MAGAZA });
    await catalog.listProducts(MAGAZA, undefined, 0, 50, MARKET);
    expect(prisma.product.findMany.mock.calls[0][0].where.store).toEqual({ ...MAGAZA_SARTI, businessUnit: MARKET });
  });
});

// ============================================================ satici paneli + ic getById

describe('VERT-02 — satici paneli ucu ve ic getById', () => {
  it('IC getById sorgusu DEGISMEDI: yalniz id + deletedAt (kapali magazayi bulur)', async () => {
    const { market, prisma } = kur();
    await expect(market.getById(MAGAZA)).resolves.toBe(magaza);
    expect(prisma.store.findFirst).toHaveBeenCalledWith({ where: { id: MAGAZA, deletedAt: null } });
  });

  it('sahip dogru dikeyde kendi KAPALI magazasini gorur', async () => {
    const { market } = kur();
    await expect(market.panelMagaza(MAGAZA, SAHIP, MERCHANT, MARKET)).resolves.toMatchObject({ id: MAGAZA, isActive: false });
  });

  it('baska satici ayni magazaya erisemez (403)', async () => {
    const { market } = kur();
    await kodu(market.panelMagaza(MAGAZA, BASKA, MERCHANT, MARKET), ForbiddenException);
  });

  it('VERT-01 kapisi: baglamsiz 400, yanlis dikey 403; admin baglamsiz gecer', async () => {
    const { market } = kur();
    await kodu(market.panelMagaza(MAGAZA, SAHIP, MERCHANT, null), BadRequestException, 'DIKEY_BAGLAMI_GEREKLI');
    await kodu(market.panelMagaza(MAGAZA, SAHIP, MERCHANT, YEMEK), ForbiddenException, 'DIKEY_UYUMSUZ');
    await expect(market.panelMagaza(MAGAZA, 'admin', [Role.ADMIN], null)).resolves.toBe(magaza);
  });

  it('uc STORE_READ ister', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, MarketController.prototype.panelMagaza)).toEqual([Permission.STORE_READ]);
  });
});

// ============================================================ satici yonetim katalog uclari

describe('VERT-02 — satici yonetim urun listesi ve kategori agaci', () => {
  it('yonetimUrunleri: sahip kapali magazada okur; sorguda vitrin (store) sarti YOK, yalniz yayindakiler', async () => {
    const { catalog, prisma } = kur();
    await catalog.yonetimUrunleri(MAGAZA, SAHIP, MERCHANT, MARKET, undefined, 0, 50);
    const where = prisma.product.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ storeId: MAGAZA, isActive: true, deletedAt: null });
  });

  it('yonetimKategorileri: sahip kapali magazada okur; tumu=1 agaci (bos kategoriler dahil), vitrin sarti YOK', async () => {
    const { catalog, prisma } = kur();
    await catalog.yonetimKategorileri(MAGAZA, SAHIP, MERCHANT, MARKET);
    expect(prisma.category.findMany.mock.calls[0][0].where).toEqual({ storeId: MAGAZA, isActive: true });
    // Magaza yalniz ic getById ile okundu (vitrin sarti sorgusu acilmadi).
    expect(prisma.store.findFirst).toHaveBeenCalledWith({ where: { id: MAGAZA, deletedAt: null } });
  });

  it.each([
    ['yonetimUrunleri', (c: CatalogService, u: string, r: Role[], d: BusinessUnit | null) => c.yonetimUrunleri(MAGAZA, u, r, d)],
    ['yonetimKategorileri', (c: CatalogService, u: string, r: Role[], d: BusinessUnit | null) => c.yonetimKategorileri(MAGAZA, u, r, d)],
  ])('%s: baska satici 403, baglamsiz 400, yanlis dikey 403, admin gecer; DB sorgusu acilmaz', async (_ad, cagri) => {
    const { catalog, prisma } = kur();
    await kodu(cagri(catalog, BASKA, MERCHANT, MARKET), ForbiddenException);
    await kodu(cagri(catalog, SAHIP, MERCHANT, null), BadRequestException, 'DIKEY_BAGLAMI_GEREKLI');
    await kodu(cagri(catalog, SAHIP, MERCHANT, YEMEK), ForbiddenException, 'DIKEY_UYUMSUZ');
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.category.findMany).not.toHaveBeenCalled();
    await expect(cagri(catalog, 'admin', [Role.ADMIN], null)).resolves.toEqual([]);
  });

  it.each(['yonetimUrunleri', 'yonetimKategorileri'] as const)('%s: PRODUCT_WRITE ister, onbellek interceptor YOK', (m) => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, CatalogController.prototype[m])).toEqual([Permission.PRODUCT_WRITE]);
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, CatalogController.prototype[m])).toBeUndefined();
  });
});

// ============================================================ onbellek ayrismasi

describe('VERT-02 — URL-anahtarli onbellekte ?dikey= ayrismasi', () => {
  it('farkli dikey degerleri birbirinin yanitini kullanmaz; ayni URL HIT', async () => {
    const { market, prisma } = kur();
    // Sahte DB: yanit istenen dikeyi yansitir, boylece karisma gozle gorulur.
    prisma.store.findMany.mockImplementation(async ({ where }: any) => [{ id: `magaza-${where.businessUnit ?? 'HEPSI'}` }]);
    const controller = new MarketController(market, {} as AuditService, {} as OnbellekService);

    const interceptor = new CacheInterceptor(await caching('memory'), new Reflector());
    (interceptor as any).httpAdapterHost = { httpAdapter: new ExpressAdapter() };

    const iste = async (url: string) => {
      const q = new URL(url, 'http://x').searchParams;
      const req = { method: 'GET', originalUrl: url, url };
      const ctx = new ExecutionContextHost([req, { set: jest.fn() }], MarketController, controller.list);
      const akis = await interceptor.intercept(ctx, {
        handle: () => from(controller.list(q.get('skip') ?? undefined, q.get('take') ?? undefined, q.get('dikey') ?? undefined)),
      });
      const r = await lastValueFrom(akis);
      await new Promise((ok) => setImmediate(ok)); // tap icindeki async set tamamlansin
      return r;
    };

    expect(await iste('/api/v1/market/stores?dikey=MARKET')).toEqual([{ id: 'magaza-MARKET' }]);
    expect(await iste('/api/v1/market/stores?dikey=YEMEK')).toEqual([{ id: 'magaza-YEMEK' }]);
    expect(await iste('/api/v1/market/stores')).toEqual([{ id: 'magaza-HEPSI' }]);
    expect(prisma.store.findMany).toHaveBeenCalledTimes(3);

    // Ayni URL tekrar: onbellekten gelir, DB'ye inilmez.
    expect(await iste('/api/v1/market/stores?dikey=MARKET')).toEqual([{ id: 'magaza-MARKET' }]);
    expect(prisma.store.findMany).toHaveBeenCalledTimes(3);
  });
});
