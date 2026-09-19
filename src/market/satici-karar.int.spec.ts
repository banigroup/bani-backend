// S4.2 — PATCH /market/sellers/:id/karar — ENTEGRASYON TESTLERI. GERCEK PostgreSQL GEREKTIRIR.
//
// NE KANITLIYOR:
//   · ucun UZERINDEKI dekoratorler (yol, JwtAuthGuard, PermissionsGuard,
//     store:manage:all, UuidParam) + GERCEK izin matrisi ADMIN/SUPER_ADMIN'i
//     geciriyor, CUSTOMER/MERCHANT'a 403 veriyor;
//   · 401: GERCEK JwtAuthGuard + uygulamanin KENDI JwtStrategy'si token'siz ve
//     bozuk token'li istegi UnauthorizedException ile durduruyor;
//   · karar gercek satirda status + redGerekce'yi yaziyor, audit AYNI
//     transaction'da tek kayit;
//   · gecersiz baslangic durumlari 409 ve DB DEGISMEZ;
//   · genel durum ucu NEEDS_FIX/REJECTED'e ve UNDER_REVIEW -> CLOSED'a kapali;
//   · GERCEK yaris: ayni saticiya eszamanli kararlarda yalniz biri kazanir,
//     digerleri 409, audit TEK;
//   · audit INSERT'i veritabaninda patlarsa karar da geri sarilir;
//   · NEEDS_FIX -> yeniden gonderim redGerekce'yi temizler.
//
// CALISTIRMA: `pnpm run test:int` + INTEGRATION_DATABASE_URL (bani_test).
// FAIL-CLOSED: hedef veritabani 'bani_test' degilse HICBIR baglanti kurulmaz.
import {
  BadRequestException, ConflictException, ForbiddenException, RequestMethod, UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { Role, SellerStatus, SellerType, SellerVerification } from '@prisma/client';
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
const HANDLER = MarketController.prototype.saticiKarar;
const IZINLI_ANAHTARLAR = ['displayName', 'id', 'redGerekce', 'status', 'verification'];

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

async function kullaniciKur(etiket: string, roller: Role[], ek: Record<string, unknown> = {}): Promise<string> {
  kullaniciSayaci += 1;
  const k = await prisma.user.create({
    data: { phone: `S42-${KOSU}-${kullaniciSayaci}-${etiket}`, name: `S42 ${etiket}`, surname: 'Test', ...ek },
  });
  olusanKullanicilar.push(k.id);
  if (roller.length > 0) {
    await prisma.userRole.createMany({ data: roller.map((role) => ({ userId: k.id, role, storeId: null })) });
  }
  return k.id;
}

/** Her senaryoya KENDI saticisi: senaryolar birbirinin durumunu kirletmez. */
async function saticiKur(ek: Record<string, unknown> = {}, sahipEk: Record<string, unknown> = {}) {
  const sahip = await kullaniciKur('sahip', [Role.CUSTOMER], sahipEk);
  const s = await prisma.seller.create({
    data: {
      ownerUserId: sahip,
      sellerType: SellerType.MARKET,
      legalName: `S42 Unvan ${KOSU}`,
      displayName: `S42 Ad ${KOSU}`,
      yetkiliAdSoyad: 'Ayse Yilmaz',
      basvuruEposta: `s42-${KOSU}@ornek.com`,
      taxIdentifier: `v1:iv:tag:S42-GIZLI-BLOB-${KOSU}`,
      taxLast4: '9999',
      status: SellerStatus.UNDER_REVIEW,
      verification: SellerVerification.BEKLIYOR,
      ...ek,
    },
  });
  return { sellerId: s.id, sahip };
}

const satirOku = (id: string) =>
  prisma.seller.findUniqueOrThrow({ where: { id }, select: { status: true, redGerekce: true, updatedAt: true } });
const auditOku = (id: string) =>
  prisma.auditLog.findMany({ where: { entity: 'Seller', entityId: id }, orderBy: { createdAt: 'asc' } });

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

describe('S4.2 — uc metadata\'si (GERCEK dekoratorler)', () => {
  it('PATCH sellers/:id/karar', () => {
    expect(Reflect.getMetadata(PATH_METADATA, HANDLER)).toBe('sellers/:id/karar');
    expect(Reflect.getMetadata(METHOD_METADATA, HANDLER)).toBe(RequestMethod.PATCH);
  });

  it('JwtAuthGuard + PermissionsGuard uc uzerinde', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, HANDLER)).toEqual([JwtAuthGuard, PermissionsGuard]);
  });

  it('store:manage:all istiyor (yeni izin YOK)', () => {
    const istenen = new Reflector().getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [HANDLER, MarketController]);
    expect(istenen).toEqual([Permission.STORE_MANAGE_ALL]);
  });

  it(':id parametresine UuidParam bagli', () => {
    const argumanlar = Reflect.getMetadata(ROUTE_ARGS_METADATA, MarketController, 'saticiKarar') as Record<
      string,
      { data: unknown; pipes: unknown[] }
    >;
    const idParam = Object.entries(argumanlar).find(
      ([anahtar, a]) => anahtar.startsWith(`${RouteParamtypes.PARAM}:`) && a.data === 'id',
    );
    expect(idParam).toBeDefined();
    expect(idParam![1].pipes).toContain(UuidParam);
  });
});

describe('S4.2 — 401 (GERCEK JwtAuthGuard + uygulamanin JwtStrategy\'si)', () => {
  beforeAll(() => {
    // Strateji passport'a 'jwt' adiyla kaydolur; guard onu kullanir.
    new JwtStrategy({ get: () => `s42-test-secret-${KOSU}` } as unknown as ConfigService, prisma);
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

describe('S4.2 — yetki (GERCEK izin matrisi + servis kapisi)', () => {
  it.each([[Role.ADMIN], [Role.SUPER_ADMIN]])('%s guard\'i gecer ve karar verebilir', async (rol) => {
    const userId = await kullaniciKur(`yetkili-${rol}`, [rol]);
    await expect(guard.canActivate(ctxUret({ id: userId, roles: [rol] }))).resolves.toBe(true);

    const { sellerId } = await saticiKur();
    const r = await market.saticiKarar([rol], sellerId, 'NEEDS_FIX', 'Eksik belge', { id: userId });
    expect(r!.status).toBe(SellerStatus.NEEDS_FIX);
  });

  it.each([[Role.CUSTOMER], [Role.MERCHANT]])('%s 403 alir (guard + servis) ve DB degismez', async (rol) => {
    const userId = await kullaniciKur(`yetkisiz-${rol}`, [rol]);
    await expect(guard.canActivate(ctxUret({ id: userId, roles: [rol] }))).rejects.toBeInstanceOf(ForbiddenException);

    const { sellerId } = await saticiKur();
    const once = await satirOku(sellerId);
    await expect(market.saticiKarar([rol], sellerId, 'REJECTED', 'x', { id: userId })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(await satirOku(sellerId)).toEqual(once);
    expect(await auditOku(sellerId)).toHaveLength(0);
  });
});

describe('S4.2 — karar (gercek satir + audit)', () => {
  it.each([
    ['NEEDS_FIX', SellerStatus.NEEDS_FIX, 'seller.needs_fix'],
    ['REJECTED', SellerStatus.REJECTED, 'seller.reject'],
  ] as const)('UNDER_REVIEW -> %s: status + kirpilmis gerekce + tek audit', async (karar, hedef, action) => {
    const { sellerId } = await saticiKur();

    const r = await market.saticiKarar([Role.ADMIN], sellerId, karar, '  Vergi levhasi okunaksiz  ', {
      id: adminId, ip: '10.4.2.1',
    });

    expect(r).toMatchObject({ id: sellerId, status: hedef, redGerekce: 'Vergi levhasi okunaksiz' });
    const satir = await satirOku(sellerId);
    expect(satir.status).toBe(hedef);
    expect(satir.redGerekce).toBe('Vergi levhasi okunaksiz');

    const kayitlar = await auditOku(sellerId);
    expect(kayitlar).toHaveLength(1);
    expect(kayitlar[0]).toMatchObject({
      actorId: adminId, action, entity: 'Seller', entityId: sellerId, ip: '10.4.2.1',
      metadata: { from: SellerStatus.UNDER_REVIEW, to: hedef, gerekce: 'Vergi levhasi okunaksiz' },
    });
  });

  it('yanit allow-list: gizli alanlar DOLU iken cikmaz', async () => {
    const { sellerId, sahip } = await saticiKur({}, { passwordHash: `S42-GIZLI-HASH-${KOSU}` });

    const r = await market.saticiKarar([Role.ADMIN], sellerId, 'REJECTED', 'Sahte belge', { id: adminId });

    expect(Object.keys(r!).sort()).toEqual(IZINLI_ANAHTARLAR);
    const metin = JSON.stringify(r);
    expect(metin).not.toContain('S42-GIZLI-BLOB');
    expect(metin).not.toContain('S42-GIZLI-HASH');
    expect(metin).not.toContain(sahip);
  });

  it.each([
    SellerStatus.DRAFT, SellerStatus.NEEDS_FIX, SellerStatus.ACTIVE, SellerStatus.SUSPENDED,
    SellerStatus.CLOSED, SellerStatus.REJECTED,
  ])('baslangic %s -> 409, satir ve audit DEGISMEZ', async (status) => {
    const { sellerId } = await saticiKur({ status, redGerekce: status === SellerStatus.REJECTED ? 'Onceki' : null });
    const once = await satirOku(sellerId);

    await expect(market.saticiKarar([Role.ADMIN], sellerId, 'REJECTED', 'Yeni', { id: adminId })).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(await satirOku(sellerId)).toEqual(once);
    expect(await auditOku(sellerId)).toHaveLength(0);
  });

  it('REJECTED terminal: ikinci karar 409, ilk gerekce korunur', async () => {
    const { sellerId } = await saticiKur();
    await market.saticiKarar([Role.ADMIN], sellerId, 'REJECTED', 'Ilk', { id: adminId });

    await expect(market.saticiKarar([Role.ADMIN], sellerId, 'NEEDS_FIX', 'Ikinci', { id: adminId })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(market.saticiDurumDegistir([Role.ADMIN], sellerId, SellerStatus.CLOSED)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await satirOku(sellerId)).toMatchObject({ status: SellerStatus.REJECTED, redGerekce: 'Ilk' });
    expect(await auditOku(sellerId)).toHaveLength(1);
  });
});

describe('S4.2 — genel durum ucu bypass kapisi (gercek satir)', () => {
  it.each([SellerStatus.NEEDS_FIX, SellerStatus.REJECTED])('hedef %s -> 400, satir DEGISMEZ', async (hedef) => {
    const { sellerId } = await saticiKur();
    const once = await satirOku(sellerId);

    await expect(market.saticiDurumDegistir([Role.ADMIN], sellerId, hedef)).rejects.toBeInstanceOf(BadRequestException);

    expect(await satirOku(sellerId)).toEqual(once);
  });

  it('UNDER_REVIEW -> CLOSED -> 409, satir DEGISMEZ', async () => {
    const { sellerId } = await saticiKur();
    const once = await satirOku(sellerId);

    await expect(market.saticiDurumDegistir([Role.ADMIN], sellerId, SellerStatus.CLOSED)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(await satirOku(sellerId)).toEqual(once);
  });

  it('REGRESYON: DRAFT -> CLOSED hala mumkun', async () => {
    const { sellerId } = await saticiKur({ status: SellerStatus.DRAFT });
    await expect(market.saticiDurumDegistir([Role.ADMIN], sellerId, SellerStatus.CLOSED)).resolves.toMatchObject({
      status: SellerStatus.CLOSED,
    });
  });
});

describe('S4.2 — eszamanlilik (GERCEK PostgreSQL transaction\'lari)', () => {
  it('ayni saticiya 5 eszamanli karar: yalniz 1 basarili, digerleri 409, audit TEK', async () => {
    const { sellerId } = await saticiKur();

    const sonuclar = await Promise.allSettled(
      ['NEEDS_FIX', 'REJECTED', 'NEEDS_FIX', 'REJECTED', 'REJECTED'].map((karar, i) =>
        market.saticiKarar([Role.ADMIN], sellerId, karar as 'NEEDS_FIX' | 'REJECTED', `Admin ${i}`, { id: adminId }),
      ),
    );

    const basarili = sonuclar.filter((s) => s.status === 'fulfilled') as PromiseFulfilledResult<{ status: SellerStatus; redGerekce: string | null } | null>[];
    const basarisiz = sonuclar.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
    expect(basarili).toHaveLength(1);
    expect(basarisiz).toHaveLength(4);
    for (const b of basarisiz) expect(b.reason).toBeInstanceOf(ConflictException);

    const kazanan = basarili[0].value!;
    const satir = await satirOku(sellerId);
    expect(satir.status).toBe(kazanan.status);
    expect(satir.redGerekce).toBe(kazanan.redGerekce);

    const kayitlar = await auditOku(sellerId);
    expect(kayitlar).toHaveLength(1);
    expect(kayitlar[0].metadata).toMatchObject({ to: kazanan.status, gerekce: kazanan.redGerekce });
  });
});

describe('S4.2 — audit hatasi -> ROLLBACK (gercek DB hatasi)', () => {
  it('audit INSERT\'i DB\'de patlarsa (gecersiz uuid actorId) karar geri sarilir', async () => {
    const { sellerId } = await saticiKur();
    const once = await satirOku(sellerId);

    // actorId kolonu @db.Uuid: gecersiz deger Postgres'te INSERT hatasi uretir.
    // Bu, audit'in transaction ICINDE yazildiginin ve hatanin yutulmadiginin
    // gercek kanitidir - sahte bir throw degil.
    await expect(
      market.saticiKarar([Role.ADMIN], sellerId, 'REJECTED', 'Gerekce', { id: 'uuid-degil' }),
    ).rejects.toBeDefined();

    expect(await satirOku(sellerId)).toEqual(once);
    expect(await auditOku(sellerId)).toHaveLength(0);
  });
});

describe('S4.2 — yeniden gonderim gerekceyi temizler', () => {
  it('UNDER_REVIEW -> NEEDS_FIX -> (satici) submit -> UNDER_REVIEW, redGerekce null', async () => {
    const { sellerId, sahip } = await saticiKur();
    await market.saticiKarar([Role.ADMIN], sellerId, 'NEEDS_FIX', 'Unvan hatali', { id: adminId });
    expect(await satirOku(sellerId)).toMatchObject({ status: SellerStatus.NEEDS_FIX, redGerekce: 'Unvan hatali' });

    const r = await market.saticiOnayaGonder(sahip);

    expect(r.status).toBe(SellerStatus.UNDER_REVIEW);
    expect(r.redGerekce).toBeNull();
    expect(await satirOku(sellerId)).toMatchObject({ status: SellerStatus.UNDER_REVIEW, redGerekce: null });
  });
});
