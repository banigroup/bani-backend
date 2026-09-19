// S4.3 — PATCH /market/sellers/:id/onay — ENTEGRASYON TESTLERI. GERCEK PostgreSQL GEREKTIRIR.
//
// NE KANITLIYOR:
//   · uc metadata'si + GERCEK izin matrisi (ADMIN/SUPER_ADMIN gecer,
//     CUSTOMER/MERCHANT 403) + GERCEK JwtAuthGuard/JwtStrategy ile 401;
//   · onay gercek satirda ACTIVE + platform MERCHANT yaziyor; owner'in MEVCUT
//     platform ve magaza rolleri BIREBIR korunuyor (BF-1: replace-all yok);
//   · MERCHANT zaten varsa tekrar yazilmiyor (roleAdded=null);
//   · satici/dogrulama/owner kapilari 409/404 ve DB DEGISMEZ;
//   · GERCEK yaris: dogrulama, onay okuduktan SONRA degisirse CAS 409 veriyor;
//     2 ve 5 eszamanli onayda tek kazanan, tek MERCHANT, tek audit;
//   · rol yazimi ya da audit DB'de patlarsa satici ACTIVE kalmiyor;
//   · genel durum ucunda UNDER_REVIEW -> ACTIVE kapali, SUSPENDED -> ACTIVE acik;
//   · Store sayisi degismiyor.
//
// CALISTIRMA: `pnpm run test:int` + INTEGRATION_DATABASE_URL (bani_test).
// FAIL-CLOSED: hedef veritabani 'bani_test' degilse HICBIR baglanti kurulmaz.
import { ConflictException, ForbiddenException, NotFoundException, RequestMethod, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { Role, SellerStatus, SellerType, SellerVerification, UserStatus } from '@prisma/client';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { SellerStatusService } from './seller-status.service';
import { AuditService } from '../common/audit/audit.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { IzinMatrisi } from '../common/rbac/izin-matrisi.service';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { Permission } from '../common/rbac/permissions.enum';
import { PERMISSIONS_KEY } from '../common/rbac/permissions.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { UuidParam } from '../common/pipes/uuid-param.pipe';
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
const HANDLER = MarketController.prototype.saticiOnayla;

let prisma: PrismaService;
let guard: PermissionsGuard;
let market: MarketService;
let adminId = '';

const olusanKullanicilar: string[] = [];
let kullaniciSayaci = 0;

function ctxUret(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => HANDLER,
    getClass: () => MarketController,
  } as never;
}

async function kullaniciKur(
  etiket: string,
  roller: Role[],
  ek: Record<string, unknown> = {},
  magazaRolleri: { role: Role; storeId: string }[] = [],
): Promise<string> {
  kullaniciSayaci += 1;
  const k = await prisma.user.create({
    data: {
      phone: `S43-${KOSU}-${kullaniciSayaci}-${etiket}`, name: `S43 ${etiket}`, surname: 'Test',
      status: UserStatus.ACTIVE, ...ek,
    },
  });
  olusanKullanicilar.push(k.id);
  const satirlar = [
    ...roller.map((role) => ({ userId: k.id, role, storeId: null as string | null })),
    ...magazaRolleri.map((m) => ({ userId: k.id, role: m.role, storeId: m.storeId })),
  ];
  if (satirlar.length > 0) await prisma.userRole.createMany({ data: satirlar });
  return k.id;
}

/** Her senaryoya KENDI owner'i ve saticisi. Varsayilan: onaylanabilir basvuru. */
async function saticiKur(
  o: { satici?: Record<string, unknown>; owner?: Record<string, unknown>; roller?: Role[]; magazaRolleri?: { role: Role; storeId: string }[] } = {},
) {
  const sahip = await kullaniciKur('sahip', o.roller ?? [Role.CUSTOMER], o.owner ?? {}, o.magazaRolleri ?? []);
  const s = await prisma.seller.create({
    data: {
      ownerUserId: sahip,
      sellerType: SellerType.MARKET,
      legalName: `S43 Unvan ${KOSU}`,
      displayName: `S43 Ad ${KOSU}`,
      taxIdentifier: `v1:iv:tag:S43-GIZLI-BLOB-${KOSU}`,
      taxLast4: '9999',
      status: SellerStatus.UNDER_REVIEW,
      verification: SellerVerification.ONAYLANDI,
      ...o.satici,
    },
  });
  return { sellerId: s.id, sahip };
}

const saticiOku = (id: string) =>
  prisma.seller.findUniqueOrThrow({ where: { id }, select: { status: true, verification: true, updatedAt: true } });
const rolKumesi = async (userId: string) =>
  (await prisma.userRole.findMany({ where: { userId }, select: { role: true, storeId: true } }))
    .map((r) => `${r.role}@${r.storeId ?? 'PLATFORM'}`)
    .sort();
const merchantSayisi = (userId: string) => prisma.userRole.count({ where: { userId, role: Role.MERCHANT, storeId: null } });
const onayAuditleri = (sellerId: string) =>
  prisma.auditLog.findMany({ where: { action: 'seller.approve', entity: 'Seller', entityId: sellerId } });

/** Seller, roller ve audit - "hicbir yazma olmadi" kaniti icin. */
async function durum(sellerId: string, sahip: string) {
  return {
    satici: await saticiOku(sellerId),
    roller: await rolKumesi(sahip),
    audit: (await onayAuditleri(sellerId)).length,
  };
}

const onayla = (sellerId: string, roles: Role[] = [Role.ADMIN], actor = adminId) =>
  market.saticiOnayla(roles, sellerId, { id: actor, ip: '10.4.3.1' });

/**
 * rolleriYaz'a benzemeyen, tek bir tx metodunu bozan sarmalayici. Transaction
 * GERCEK; yalnizca istenen delegate metodu firlatir. Boylece "CAS gercekten
 * yazildiktan SONRA gelen hata onu geri sariyor mu" sorusu gercek DB'de sorulur.
 */
function txMetoduBozuk(model: 'userRole', metot: 'create'): PrismaService {
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

  guard = new PermissionsGuard(new Reflector(), new IzinMatrisi(prisma));
  market = new MarketService(prisma, new AuditService(prisma), new SellerStatusService(), new SozlesmeService(prisma));
  adminId = await kullaniciKur('admin', [Role.ADMIN]);
});

afterAll(async () => {
  if (!prisma) return;
  testVeritabaniUrl(); // DEFENSE IN DEPTH

  if (olusanKullanicilar.length > 0) {
    const saticilar = await prisma.seller.findMany({
      where: { ownerUserId: { in: olusanKullanicilar } }, select: { id: true },
    });
    const saticiIdleri = saticilar.map((s) => s.id);
    await prisma.auditLog.deleteMany({ where: { entity: 'Seller', entityId: { in: saticiIdleri } } });
    await prisma.seller.deleteMany({ where: { id: { in: saticiIdleri } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: olusanKullanicilar } } });
    await prisma.user.deleteMany({ where: { id: { in: olusanKullanicilar } } });
  }
  await prisma.$disconnect();
});

// ===================================================================== testler

describe('S4.3 — uc metadata\'si (GERCEK dekoratorler)', () => {
  it('PATCH sellers/:id/onay', () => {
    expect(Reflect.getMetadata(PATH_METADATA, HANDLER)).toBe('sellers/:id/onay');
    expect(Reflect.getMetadata(METHOD_METADATA, HANDLER)).toBe(RequestMethod.PATCH);
  });

  it('JwtAuthGuard + PermissionsGuard uc uzerinde', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, HANDLER)).toEqual([JwtAuthGuard, PermissionsGuard]);
  });

  it('store:manage:all istiyor (yeni izin YOK)', () => {
    const istenen = new Reflector().getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [HANDLER, MarketController]);
    expect(istenen).toEqual([Permission.STORE_MANAGE_ALL]);
  });

  it(':id UuidParam; govde parametresi YOK', () => {
    const argumanlar = Reflect.getMetadata(ROUTE_ARGS_METADATA, MarketController, 'saticiOnayla') as Record<
      string,
      { data: unknown; pipes: unknown[] }
    >;
    const idParam = Object.entries(argumanlar).find(
      ([anahtar, a]) => anahtar.startsWith(`${RouteParamtypes.PARAM}:`) && a.data === 'id',
    );
    expect(idParam![1].pipes).toContain(UuidParam);
    expect(Object.keys(argumanlar).some((k) => k.startsWith(`${RouteParamtypes.BODY}:`))).toBe(false);
  });
});

describe('S4.3 — 401 (GERCEK JwtAuthGuard + uygulamanin JwtStrategy\'si)', () => {
  beforeAll(() => {
    new JwtStrategy({ get: () => `s43-test-secret-${KOSU}` } as unknown as ConfigService, prisma);
  });

  const httpCtx = (headers: Record<string, string>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }), getResponse: () => ({}) }),
      getHandler: () => HANDLER,
      getClass: () => MarketController,
    }) as never;

  it('token yok -> 401', async () => {
    await expect(new JwtAuthGuard().canActivate(httpCtx({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('bozuk token -> 401', async () => {
    await expect(
      new JwtAuthGuard().canActivate(httpCtx({ authorization: 'Bearer bozuk.token.degeri' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('S4.3 — yetki (GERCEK izin matrisi + servis kapisi)', () => {
  it.each([[Role.ADMIN], [Role.SUPER_ADMIN]])('%s guard\'i gecer ve onaylayabilir', async (rol) => {
    const userId = await kullaniciKur(`yetkili-${rol}`, [rol]);
    await expect(guard.canActivate(ctxUret({ id: userId, roles: [rol] }))).resolves.toBe(true);

    const { sellerId } = await saticiKur();
    await expect(onayla(sellerId, [rol], userId)).resolves.toMatchObject({ status: SellerStatus.ACTIVE });
  });

  it.each([[Role.CUSTOMER], [Role.MERCHANT]])('%s 403 alir (guard + servis), DB degismez', async (rol) => {
    const userId = await kullaniciKur(`yetkisiz-${rol}`, [rol]);
    await expect(guard.canActivate(ctxUret({ id: userId, roles: [rol] }))).rejects.toBeInstanceOf(ForbiddenException);

    const { sellerId, sahip } = await saticiKur();
    const once = await durum(sellerId, sahip);
    await expect(onayla(sellerId, [rol], userId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await durum(sellerId, sahip)).toEqual(once);
  });
});

describe('S4.3 — onay (gercek satir, roller, audit)', () => {
  it('UNDER_REVIEW + ONAYLANDI -> ACTIVE + MERCHANT, CUSTOMER korunur, tek audit', async () => {
    const { sellerId, sahip } = await saticiKur();

    const r = await onayla(sellerId);

    expect(r).toEqual({
      id: sellerId, status: SellerStatus.ACTIVE, verification: SellerVerification.ONAYLANDI,
      displayName: `S43 Ad ${KOSU}`, merchantRolu: 'EKLENDI',
    });
    expect((await saticiOku(sellerId)).status).toBe(SellerStatus.ACTIVE);
    expect(await rolKumesi(sahip)).toEqual(['CUSTOMER@PLATFORM', 'MERCHANT@PLATFORM']);

    const kayitlar = await onayAuditleri(sellerId);
    expect(kayitlar).toHaveLength(1);
    expect(kayitlar[0]).toMatchObject({
      actorId: adminId, entity: 'Seller', entityId: sellerId, ip: '10.4.3.1',
      metadata: { from: 'UNDER_REVIEW', to: 'ACTIVE', roleAdded: 'MERCHANT' },
    });
  });

  it('BF-1: birden fazla platform rolu + magaza kapsamli roller BIREBIR korunur', async () => {
    const magaza = randomUUID();
    const { sellerId, sahip } = await saticiKur({
      roller: [Role.CUSTOMER, Role.LOAD_CUSTOMER, Role.CARRIER, Role.COURIER],
      magazaRolleri: [{ role: Role.STORE_STAFF, storeId: magaza }, { role: Role.STORE_KITCHEN, storeId: magaza }],
    });
    const once = await rolKumesi(sahip);

    await onayla(sellerId);

    expect(await rolKumesi(sahip)).toEqual([...once, 'MERCHANT@PLATFORM'].sort());
  });

  it('MERCHANT zaten varsa: basari, satir sayisi 1 kalir, roleAdded=null', async () => {
    const { sellerId, sahip } = await saticiKur({ roller: [Role.CUSTOMER, Role.MERCHANT] });
    const once = await rolKumesi(sahip);

    const r = await onayla(sellerId);

    expect(r.merchantRolu).toBe('ZATEN_VARDI');
    expect(await rolKumesi(sahip)).toEqual(once);
    expect(await merchantSayisi(sahip)).toBe(1);
    const kayitlar = await onayAuditleri(sellerId);
    expect(kayitlar).toHaveLength(1);
    expect(kayitlar[0].metadata).toMatchObject({ roleAdded: null });
  });

  it('yanit allow-list: gizli alanlar DOLU iken cikmaz', async () => {
    const { sellerId, sahip } = await saticiKur({ owner: { passwordHash: `S43-GIZLI-HASH-${KOSU}` } });

    const r = await onayla(sellerId);

    expect(Object.keys(r).sort()).toEqual(['displayName', 'id', 'merchantRolu', 'status', 'verification']);
    const metin = JSON.stringify(r);
    expect(metin).not.toContain('S43-GIZLI-BLOB');
    expect(metin).not.toContain('S43-GIZLI-HASH');
    expect(metin).not.toContain(sahip);
    expect(metin).not.toContain('CUSTOMER');
  });

  it('Store OLUSTURULMAZ: onay oncesi/sonrasi Store sayisi ayni', async () => {
    const { sellerId } = await saticiKur();
    const once = await prisma.store.count();
    await onayla(sellerId);
    expect(await prisma.store.count()).toBe(once);
  });
});

describe('S4.3 — kapilar: 404/409 ve HICBIR yazma yok', () => {
  it.each([
    SellerVerification.EKSIK, SellerVerification.BEKLIYOR, SellerVerification.REDDEDILDI, SellerVerification.SURESI_DOLDU,
  ])('verification %s -> 409', async (verification) => {
    const { sellerId, sahip } = await saticiKur({ satici: { verification } });
    const once = await durum(sellerId, sahip);
    await expect(onayla(sellerId)).rejects.toBeInstanceOf(ConflictException);
    expect(await durum(sellerId, sahip)).toEqual(once);
  });

  it.each([
    SellerStatus.DRAFT, SellerStatus.NEEDS_FIX, SellerStatus.ACTIVE, SellerStatus.SUSPENDED,
    SellerStatus.CLOSED, SellerStatus.REJECTED,
  ])('status %s -> 409', async (status) => {
    const { sellerId, sahip } = await saticiKur({ satici: { status } });
    const once = await durum(sellerId, sahip);
    await expect(onayla(sellerId)).rejects.toBeInstanceOf(ConflictException);
    expect(await durum(sellerId, sahip)).toEqual(once);
  });

  it('soft-deleted satici -> 404', async () => {
    const { sellerId, sahip } = await saticiKur({ satici: { deletedAt: new Date() } });
    const once = await durum(sellerId, sahip);
    await expect(onayla(sellerId)).rejects.toBeInstanceOf(NotFoundException);
    expect(await durum(sellerId, sahip)).toEqual(once);
  });

  it('var olmayan satici -> 404', async () => {
    await expect(onayla(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['soft-deleted', { deletedAt: new Date() }],
    ['SUSPENDED', { status: UserStatus.SUSPENDED }],
    ['BANNED', { status: UserStatus.BANNED }],
    ['DELETED', { status: UserStatus.DELETED }],
  ])('owner %s -> 409, satici ACTIVE olmaz, MERCHANT/audit yok', async (_ad, owner) => {
    const { sellerId, sahip } = await saticiKur({ owner });
    const once = await durum(sellerId, sahip);
    await expect(onayla(sellerId)).rejects.toBeInstanceOf(ConflictException);
    expect(await durum(sellerId, sahip)).toEqual(once);
    expect(once.satici.status).toBe(SellerStatus.UNDER_REVIEW);
  });
});

describe('S4.3 — atomiklik (gercek DB hatalari)', () => {
  it('rol yazimi patlarsa: CAS geri sarilir, satici UNDER_REVIEW, audit yok', async () => {
    const { sellerId, sahip } = await saticiKur();
    const once = await durum(sellerId, sahip);
    const bozukMarket = new MarketService(
      txMetoduBozuk('userRole', 'create'), new AuditService(prisma), new SellerStatusService(), new SozlesmeService(prisma),
    );

    await expect(bozukMarket.saticiOnayla([Role.ADMIN], sellerId, { id: adminId })).rejects.toThrow('userRole.create yazilamadi');

    expect(await durum(sellerId, sahip)).toEqual(once);
  });

  it('audit INSERT\'i DB\'de patlarsa (gecersiz uuid actorId): ACTIVE ve MERCHANT geri sarilir', async () => {
    const { sellerId, sahip } = await saticiKur();
    const once = await durum(sellerId, sahip);

    await expect(onayla(sellerId, [Role.ADMIN], 'uuid-degil')).rejects.toBeDefined();

    expect(await durum(sellerId, sahip)).toEqual(once);
    expect(await merchantSayisi(sahip)).toBe(0);
  });
});

describe('S4.3 — eszamanlilik (GERCEK PostgreSQL transaction\'lari)', () => {
  it('dogrulama yarisi: onay ONAYLANDI okuduktan SONRA verification degisirse CAS 409', async () => {
    const { sellerId, sahip } = await saticiKur();
    let sonuc: Promise<unknown> = Promise.resolve();

    await prisma.$transaction(
      async (engel) => {
        // Satiri kilitle ve dogrulamayi dusur - COMMIT ETMEDEN.
        await engel.seller.update({ where: { id: sellerId }, data: { verification: SellerVerification.REDDEDILDI } });
        // Onay commit edilmis ONAYLANDI'yi okur, owner kapisini gecer, CAS'ta kilide takilir.
        sonuc = onayla(sellerId).then((v) => ({ v }), (e: unknown) => ({ e }));
        const bitis = Date.now() + 15000;
        for (;;) {
          const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`;
          if (n > 0) break;
          if (Date.now() > bitis) throw new Error('onay CAS kilidinde beklemeye hic girmedi');
          await new Promise((r) => setTimeout(r, 25));
        }
      },
      { timeout: 30000 },
    );

    const r = (await sonuc) as { e?: unknown };
    expect(r.e).toBeInstanceOf(ConflictException);
    const son = await saticiOku(sellerId);
    expect(son.status).toBe(SellerStatus.UNDER_REVIEW);
    expect(son.verification).toBe(SellerVerification.REDDEDILDI);
    expect(await merchantSayisi(sahip)).toBe(0);
    expect(await onayAuditleri(sellerId)).toHaveLength(0);
  });

  it.each([2, 5])('%i eszamanli onay: 1 basarili, digerleri 409; tek ACTIVE, tek MERCHANT, tek audit', async (n) => {
    const { sellerId, sahip } = await saticiKur({ roller: [Role.CUSTOMER, Role.CARRIER] });

    const sonuclar = await Promise.allSettled(Array.from({ length: n }, () => onayla(sellerId)));

    const basarili = sonuclar.filter((s) => s.status === 'fulfilled');
    const basarisiz = sonuclar.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
    expect(basarili).toHaveLength(1);
    expect(basarisiz).toHaveLength(n - 1);
    for (const b of basarisiz) expect(b.reason).toBeInstanceOf(ConflictException);

    expect((await saticiOku(sellerId)).status).toBe(SellerStatus.ACTIVE);
    expect(await merchantSayisi(sahip)).toBe(1);
    expect(await rolKumesi(sahip)).toEqual(['CARRIER@PLATFORM', 'CUSTOMER@PLATFORM', 'MERCHANT@PLATFORM']);
    expect(await onayAuditleri(sellerId)).toHaveLength(1);
  });
});

describe('S4.3 — genel durum ucu (gercek satir)', () => {
  it('UNDER_REVIEW -> ACTIVE 409; satici, roller, audit DEGISMEZ', async () => {
    const { sellerId, sahip } = await saticiKur();
    const once = await durum(sellerId, sahip);

    await expect(market.saticiDurumDegistir([Role.ADMIN], sellerId, SellerStatus.ACTIVE)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(await durum(sellerId, sahip)).toEqual(once);
  });

  it('REGRESYON: SUSPENDED -> ACTIVE calisir, rol yazmaz', async () => {
    const { sellerId, sahip } = await saticiKur({ satici: { status: SellerStatus.SUSPENDED }, roller: [Role.MERCHANT] });
    const onceRoller = await rolKumesi(sahip);

    await expect(market.saticiDurumDegistir([Role.ADMIN], sellerId, SellerStatus.ACTIVE)).resolves.toMatchObject({
      status: SellerStatus.ACTIVE,
    });

    expect(await rolKumesi(sahip)).toEqual(onceRoller);
  });
});
