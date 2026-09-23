// S4.4 — POST /market/stores (ILK MAGAZA KURULUMU) — ENTEGRASYON TESTLERI. GERCEK PostgreSQL GEREKTIRIR.
//
// NE KANITLIYOR:
//   · uc metadata'si (STORE_WRITE, guard'lar) + GERCEK JwtAuthGuard/JwtStrategy ile 401;
//   · ACTIVE satici + ACTIVE owner -> talepEdilenDikey'deki (MARKET/YEMEK/CARSI)
//     aktif magaza; ownerId/sellerId dogru; owner'in rolleri BIREBIR ayni
//     (MERCHANT korunur, STORE_* yazilmaz); tek store.create audit'i;
//   · satici/owner/dikey kapilari 409 ve DB DEGISMEZ; saticisi olmayan
//     kullanici icin DRAFT Seller YARATILMAZ;
//   · GERCEK yaris: ayni saticiya 2 ve 5 eszamanli istek -> 1 magaza, geri
//     kalan 409, tek audit; farkli saticilarin ayni-ad (slug) yarisi 500 uretmez;
//   · audit INSERT'i tx icinde patlarsa magaza da geri sarilir;
//   · DIKEY IZOLASYONU: MARKET/YEMEK/CARSI saticisi yalniz KENDI magazasinin
//     magaza/urun/siparis kaynagina erisir; digerleri 403 - gercek servis
//     yollariyla (market.update, catalog.listPending/urunDetay,
//     orders.storeOrders/getOne).
//
// CALISTIRMA: `pnpm run test:int` + INTEGRATION_DATABASE_URL (bani_test).
// FAIL-CLOSED: hedef veritabani 'bani_test' degilse HICBIR baglanti kurulmaz.
import { ConflictException, ForbiddenException, RequestMethod, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { BusinessUnit, Role, SellerStatus, SellerType, SellerVerification, UserStatus } from '@prisma/client';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { SellerStatusService } from './seller-status.service';
import { AuditService } from '../common/audit/audit.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { CatalogService } from '../catalog/catalog.service';
import { OrdersService } from '../orders/orders.service';
import { Permission } from '../common/rbac/permissions.enum';
import { PERMISSIONS_KEY } from '../common/rbac/permissions.decorator';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
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
const HANDLER = MarketController.prototype.create;

let prisma: PrismaService;
let market: MarketService;

const olusanKullanicilar: string[] = [];
let sayac = 0;

async function kullaniciKur(etiket: string, roller: Role[], ek: Record<string, unknown> = {}): Promise<string> {
  sayac += 1;
  const k = await prisma.user.create({
    data: { phone: `S44-${KOSU}-${sayac}-${etiket}`, name: `S44 ${etiket}`, surname: 'Test', status: UserStatus.ACTIVE, ...ek },
  });
  olusanKullanicilar.push(k.id);
  if (roller.length > 0) {
    await prisma.userRole.createMany({ data: roller.map((role) => ({ userId: k.id, role, storeId: null })) });
  }
  return k.id;
}

/** Varsayilan: S4.3 sonrasi hal - ACTIVE satici, MERCHANT sahip. */
async function saticiKur(o: { satici?: Record<string, unknown>; owner?: Record<string, unknown>; roller?: Role[] } = {}) {
  const sahip = await kullaniciKur('sahip', o.roller ?? [Role.CUSTOMER, Role.MERCHANT], o.owner ?? {});
  const s = await prisma.seller.create({
    data: {
      ownerUserId: sahip,
      sellerType: SellerType.MARKET,
      legalName: `S44 Unvan ${KOSU}`,
      displayName: `S44 Ad ${KOSU}`,
      talepEdilenDikey: BusinessUnit.MARKET,
      status: SellerStatus.ACTIVE,
      verification: SellerVerification.ONAYLANDI,
      ...o.satici,
    },
  });
  return { sellerId: s.id, sahip };
}

const magazaAdi = (ek: string) => `S44 ${KOSU} ${ek}`;
const kur = (sahip: string, ad: string) => market.create(sahip, { name: ad }, '10.4.4.1');
const magazalar = (sellerId: string) => prisma.store.findMany({ where: { sellerId } });
const rolKumesi = async (userId: string) =>
  (await prisma.userRole.findMany({ where: { userId }, select: { role: true, storeId: true } }))
    .map((r) => `${r.role}@${r.storeId ?? 'PLATFORM'}`)
    .sort();
const kurulumAuditleri = (sellerId: string) =>
  prisma.auditLog.findMany({ where: { action: 'store.create', metadata: { path: ['sellerId'], equals: sellerId } } });

async function durum(sellerId: string, sahip: string) {
  return {
    magazalar: (await magazalar(sellerId)).length,
    saticilar: await prisma.seller.count({ where: { ownerUserId: sahip } }),
    roller: await rolKumesi(sahip),
    audit: (await kurulumAuditleri(sellerId)).length,
  };
}

/** Tek bir tx delegate metodunu bozan sarmalayici; transaction GERCEK. */
function txMetoduBozuk(model: string, metot: string): PrismaService {
  return new Proxy(prisma, {
    get(hedef, anahtar, alici) {
      if (anahtar !== '$transaction') return Reflect.get(hedef, anahtar, alici);
      return (fn: (tx: unknown) => Promise<unknown>) =>
        hedef.$transaction((tx) =>
          fn(new Proxy(tx, {
            get(t, a) {
              if (a !== model) return Reflect.get(t, a);
              return new Proxy(Reflect.get(t, a) as object, {
                get(d, m) {
                  if (m === metot) return async () => { throw new Error(`${model}.${metot} yazilamadi (test)`); };
                  return Reflect.get(d, m);
                },
              });
            },
          })),
        );
    },
  });
}

// ==================================================================== kurulum

beforeAll(async () => {
  const url = testVeritabaniUrl();
  prisma = new PrismaService({ datasources: { db: { url } } });
  await prisma.$connect();
  market = new MarketService(prisma, new AuditService(prisma), new SellerStatusService(), new SozlesmeService(prisma));
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
    await prisma.store.deleteMany({ where: { id: { in: magazaIdleri } } });
    await prisma.seller.deleteMany({ where: { id: { in: saticilar } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: olusanKullanicilar } } });
    await prisma.user.deleteMany({ where: { id: { in: olusanKullanicilar } } });
  }
  await prisma.$disconnect();
});

// ===================================================================== testler

describe('S4.4 — uc metadata\'si ve 401', () => {
  it('POST stores; JwtAuthGuard + PermissionsGuard; store:write (yeni izin YOK)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, HANDLER)).toBe('stores');
    expect(Reflect.getMetadata(METHOD_METADATA, HANDLER)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(GUARDS_METADATA, HANDLER)).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(new Reflector().getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [HANDLER, MarketController])).toEqual([
      Permission.STORE_WRITE,
    ]);
  });

  it('token yok / bozuk token -> 401 (gercek JwtStrategy)', async () => {
    new JwtStrategy({ get: () => `s44-test-secret-${KOSU}` } as unknown as ConfigService, prisma);
    const ctx = (headers: Record<string, string>) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ headers }), getResponse: () => ({}) }),
        getHandler: () => HANDLER,
        getClass: () => MarketController,
      }) as never;
    await expect(new JwtAuthGuard().canActivate(ctx({}))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(new JwtAuthGuard().canActivate(ctx({ authorization: 'Bearer bozuk.token' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('S4.4 — ilk magaza kurulumu (gercek satirlar)', () => {
  it.each([BusinessUnit.MARKET, BusinessUnit.YEMEK, BusinessUnit.CARSI])(
    'talepEdilenDikey %s -> o dikeyde aktif magaza; ownerId/sellerId dogru; roller ayni; tek audit',
    async (dikey) => {
      const { sellerId, sahip } = await saticiKur({ satici: { talepEdilenDikey: dikey } });
      const onceRoller = await rolKumesi(sahip);

      const r = await kur(sahip, magazaAdi(`basari-${dikey}`));

      expect(r).toMatchObject({ businessUnit: dikey, isActive: true, name: magazaAdi(`basari-${dikey}`) });
      const [satir] = await magazalar(sellerId);
      expect(satir).toMatchObject({ id: r.id, ownerId: sahip, sellerId, businessUnit: dikey, isActive: true, deletedAt: null });

      // MERCHANT korunur, magaza kapsamli personel rolu YAZILMAZ.
      expect(await rolKumesi(sahip)).toEqual(onceRoller);
      expect(await prisma.userRole.count({ where: { userId: sahip, storeId: { not: null } } })).toBe(0);

      const kayitlar = await kurulumAuditleri(sellerId);
      expect(kayitlar).toHaveLength(1);
      expect(kayitlar[0]).toMatchObject({
        actorId: sahip, entity: 'Store', entityId: r.id, ip: '10.4.4.1',
        metadata: { sellerId, businessUnit: dikey, ilkMagaza: true },
      });
    },
  );

  it('yanit allow-list: ownerId/sellerId/commissionRate/deletedAt/revision yok', async () => {
    const { sahip } = await saticiKur();
    const r = await kur(sahip, magazaAdi('allowlist'));
    expect(Object.keys(r).sort()).toEqual([
      'businessUnit', 'city', 'createdAt', 'description', 'district', 'id', 'isActive', 'line1', 'logoUrl',
      'minOrder', 'name', 'phone', 'slug', 'type',
    ]);
    expect(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(sahip);
  });

  it('ikinci istek (magaza zaten var) -> 409, ikinci magaza YOK', async () => {
    const { sellerId, sahip } = await saticiKur();
    await kur(sahip, magazaAdi('ilk'));
    await expect(kur(sahip, magazaAdi('ikinci'))).rejects.toBeInstanceOf(ConflictException);
    expect(await magazalar(sellerId)).toHaveLength(1);
    expect(await kurulumAuditleri(sellerId)).toHaveLength(1);
  });
});

describe('S4.4 — kapilar: 409 ve DB DEGISMEZ', () => {
  it.each([
    SellerStatus.DRAFT, SellerStatus.UNDER_REVIEW, SellerStatus.NEEDS_FIX, SellerStatus.REJECTED,
    SellerStatus.SUSPENDED, SellerStatus.CLOSED,
  ])('satici %s -> 409', async (status) => {
    const { sellerId, sahip } = await saticiKur({ satici: { status } });
    const once = await durum(sellerId, sahip);
    await expect(kur(sahip, magazaAdi(`s-${status}`))).rejects.toBeInstanceOf(ConflictException);
    expect(await durum(sellerId, sahip)).toEqual(once);
  });

  it.each([
    ['soft-deleted', { deletedAt: new Date() }],
    ['SUSPENDED', { status: UserStatus.SUSPENDED }],
    ['BANNED', { status: UserStatus.BANNED }],
    ['DELETED', { status: UserStatus.DELETED }],
  ])('owner %s -> 409', async (_ad, owner) => {
    const { sellerId, sahip } = await saticiKur({ owner });
    const once = await durum(sellerId, sahip);
    await expect(kur(sahip, magazaAdi(`o-${_ad}`))).rejects.toBeInstanceOf(ConflictException);
    expect(await durum(sellerId, sahip)).toEqual(once);
  });

  it.each([null, BusinessUnit.LOAD, BusinessUnit.COFFEE])('talepEdilenDikey %s -> 409', async (dikey) => {
    const { sellerId, sahip } = await saticiKur({ satici: { talepEdilenDikey: dikey } });
    const once = await durum(sellerId, sahip);
    await expect(kur(sahip, magazaAdi(`d-${dikey}`))).rejects.toBeInstanceOf(ConflictException);
    expect(await durum(sellerId, sahip)).toEqual(once);
  });

  it.each([
    ['MERCHANT', [Role.MERCHANT]],
    ['ADMIN', [Role.ADMIN]],
  ])('satici kaydi olmayan %s -> 409; otomatik DRAFT Seller YARATILMAZ', async (_ad, roller) => {
    const kisi = await kullaniciKur(`saticisiz-${_ad}`, roller);
    await expect(kur(kisi, magazaAdi(`saticisiz-${_ad}`))).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.seller.count({ where: { ownerUserId: kisi } })).toBe(0);
    expect(await prisma.store.count({ where: { ownerId: kisi } })).toBe(0);
  });
});

describe('S4.4 — atomiklik (gercek transaction)', () => {
  it('audit yazimi patlarsa magaza da geri sarilir', async () => {
    const { sellerId, sahip } = await saticiKur();
    const once = await durum(sellerId, sahip);
    const bozuk = new MarketService(
      txMetoduBozuk('auditLog', 'create'), new AuditService(prisma), new SellerStatusService(), new SozlesmeService(prisma),
    );

    await expect(bozuk.create(sahip, { name: magazaAdi('audit-patlar') })).rejects.toThrow('auditLog.create yazilamadi');

    expect(await durum(sellerId, sahip)).toEqual(once);
    expect(await prisma.store.count({ where: { name: magazaAdi('audit-patlar') } })).toBe(0);
  });
});

describe('S4.4 — eszamanlilik (GERCEK PostgreSQL transaction\'lari)', () => {
  it.each([2, 5])('ayni saticiya %i eszamanli ilk-magaza istegi: 1 basarili, geri kalan 409; tek magaza, tek audit', async (n) => {
    const { sellerId, sahip } = await saticiKur();

    const sonuclar = await Promise.allSettled(Array.from({ length: n }, (_, i) => kur(sahip, magazaAdi(`yaris${n}-${i}`))));

    const basarili = sonuclar.filter((s) => s.status === 'fulfilled');
    const basarisiz = sonuclar.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
    expect(basarili).toHaveLength(1);
    expect(basarisiz).toHaveLength(n - 1);
    for (const b of basarisiz) expect(b.reason).toBeInstanceOf(ConflictException);
    expect(await magazalar(sellerId)).toHaveLength(1);
    expect(await kurulumAuditleri(sellerId)).toHaveLength(1);
  });

  it('farkli saticilarin AYNI adla eszamanli kurulumu: kontrolsuz 500 yok (basari ya da 409)', async () => {
    const ad = magazaAdi('ayni-ad');
    const kisiler = await Promise.all(Array.from({ length: 4 }, () => saticiKur()));

    const sonuclar = await Promise.allSettled(kisiler.map((k) => kur(k.sahip, ad)));

    for (const s of sonuclar) {
      if (s.status === 'rejected') expect(s.reason).toBeInstanceOf(ConflictException);
    }
    expect(sonuclar.some((s) => s.status === 'fulfilled')).toBe(true);
    const sluglar = (await prisma.store.findMany({ where: { name: ad }, select: { slug: true } })).map((m) => m.slug);
    expect(new Set(sluglar).size).toBe(sluglar.length);
  });
});

describe('S4.4 — DIKEY IZOLASYONU (gercek servis yetki yollari)', () => {
  type Kimlik = { dikey: BusinessUnit; user: AuthUser; storeId: string; productId: string; orderId: string };
  const kimlikler: Kimlik[] = [];
  let catalog: CatalogService;
  let orders: OrdersService;

  beforeAll(async () => {
    catalog = new CatalogService(prisma, market);
    // Yetki kapisi market.erisebilir; siparis okuma yollari ledger/cuzdan/bildirime dokunmaz.
    orders = new OrdersService(prisma, {} as never, {} as never, {} as never, {} as never, market);
    const musteri = await kullaniciKur('musteri', [Role.CUSTOMER]);

    for (const dikey of [BusinessUnit.MARKET, BusinessUnit.YEMEK, BusinessUnit.CARSI]) {
      const { sahip } = await saticiKur({ satici: { talepEdilenDikey: dikey } });
      const magaza = await kur(sahip, magazaAdi(`izolasyon-${dikey}`)); // GERCEK kurulum yolu
      const urun = await prisma.product.create({
        data: { storeId: magaza.id, name: `S44 urun ${dikey}`, slug: `s44-${KOSU}-${dikey.toLowerCase()}`, price: 1000n },
      });
      const siparis = await prisma.order.create({
        data: {
          orderNo: `S44-${KOSU}-${dikey}`, userId: musteri, storeId: magaza.id, businessUnit: dikey,
          subtotal: 1000n, total: 1000n,
        },
      });
      kimlikler.push({
        dikey, user: { id: sahip, roles: [Role.CUSTOMER, Role.MERCHANT] } as AuthUser,
        storeId: magaza.id, productId: urun.id, orderId: siparis.id,
      });
    }
  });

  // VERT-01: her kimlik KENDI dikeyinin panel baglamiyla (X-Bani-Dikey) cagirir.
  const kaynaklar: [string, (k: Kimlik, hedef: Kimlik) => Promise<unknown>][] = [
    ['Store (PATCH stores/:id)', (k, h) => market.update(h.storeId, k.user.id, k.user.roles, { description: `${k.dikey} yazdi` }, undefined, k.dikey)],
    ['Store (calisma saatleri)', (k, h) => market.calismaSaatleri(h.storeId, k.user.id, k.user.roles, k.dikey)],
    ['Product (bekleyen urunler)', (k, h) => catalog.listPending(h.storeId, k.user.id, k.user.roles, k.dikey)],
    ['Product (urun detay)', (k, h) => catalog.urunDetay(h.productId, k.user.id, k.user.roles, k.dikey)],
    ['Order (magaza siparisleri)', (k, h) => orders.storeOrders(k.user, h.storeId, k.dikey)],
    ['Order (siparis detay)', (k, h) => orders.getOne(k.user, h.orderId, k.dikey)],
  ];

  for (const kimlikDikey of [BusinessUnit.MARKET, BusinessUnit.YEMEK, BusinessUnit.CARSI]) {
    for (const hedefDikey of [BusinessUnit.MARKET, BusinessUnit.YEMEK, BusinessUnit.CARSI]) {
      const beklenen = kimlikDikey === hedefDikey ? 'ALLOWED' : '403';
      it.each(kaynaklar)(`${kimlikDikey} saticisi -> ${hedefDikey} %s = ${beklenen}`, async (_ad, cagri) => {
        const k = kimlikler.find((x) => x.dikey === kimlikDikey)!;
        const h = kimlikler.find((x) => x.dikey === hedefDikey)!;
        if (beklenen === 'ALLOWED') {
          await expect(cagri(k, h)).resolves.toBeDefined();
        } else {
          await expect(cagri(k, h)).rejects.toBeInstanceOf(ForbiddenException);
        }
      });
    }
  }

  it('her kimligin magazasi YALNIZ kendi dikeyinde', async () => {
    for (const k of kimlikler) {
      const m = await prisma.store.findUniqueOrThrow({ where: { id: k.storeId }, select: { businessUnit: true, ownerId: true } });
      expect(m).toEqual({ businessUnit: k.dikey, ownerId: k.user.id });
    }
  });
});
