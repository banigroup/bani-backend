// S4.1 — GET /market/sellers/:id — ENTEGRASYON TESTLERI. GERCEK PostgreSQL GEREKTIRIR.
//
// NE KANITLIYOR:
//   · ucun UZERINDEKI dekoratorler (yol, JwtAuthGuard, PermissionsGuard,
//     store:manage:all, UuidParam) + GERCEK izin matrisi birlikte ADMIN ve
//     SUPER_ADMIN'i geciriyor, CUSTOMER'a 403 veriyor;
//   · gercek satirlarda taxIdentifier ve passwordHash DOLU iken yanita
//     cikmiyor; belge/sozlesme kapsami gercek iliski suzgeciyle dogru;
//   · cagri oncesi/sonrasi DB anlik goruntusu birebir ayni (salt okuma).
//
// 401 NEDEN METADATA ILE: repoda supertest / @nestjs/testing YOK (bkz.
// satici-olustur-yetki.int.spec.ts basligi). JwtAuthGuard'in uc uzerinde
// bulundugu burada kanitlaniyor; gercek HTTP 401 canli kabul adiminda.
//
// CALISTIRMA: `pnpm run test:int` + INTEGRATION_DATABASE_URL (bani_test).
// FAIL-CLOSED: hedef veritabani 'bani_test' degilse HICBIR baglanti kurulmaz.
import { ForbiddenException, NotFoundException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import {
  Role, SaticiBelgeDurum, SaticiBelgeTipi, SellerStatus, SellerType, SellerVerification, SozlesmeTipi,
} from '@prisma/client';
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
const HANDLER = MarketController.prototype.saticiDetay;

let prisma: PrismaService;
let guard: PermissionsGuard;
let market: MarketService;

const olusanKullanicilar: string[] = [];
let kullaniciSayaci = 0;

// Senaryo kimlikleri
let sahipA = '';
let sahipB = '';
let sahipSilik = '';
let saticiA = '';
let saticiB = '';
let saticiSilik = '';

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
    data: { phone: `S41-${KOSU}-${kullaniciSayaci}-${etiket}`, name: `S41 ${etiket}`, surname: 'Test', ...ek },
  });
  olusanKullanicilar.push(k.id);
  if (roller.length > 0) {
    await prisma.userRole.createMany({ data: roller.map((role) => ({ userId: k.id, role, storeId: null })) });
  }
  return k.id;
}

async function saticiKur(sahip: string, ek: Record<string, unknown> = {}): Promise<string> {
  const s = await prisma.seller.create({
    data: {
      ownerUserId: sahip,
      sellerType: SellerType.MARKET,
      legalName: `S41 Unvan ${KOSU}`,
      displayName: `S41 Ad ${KOSU}`,
      yetkiliAdSoyad: 'Ayse Yilmaz',
      basvuruEposta: `s41-${KOSU}@ornek.com`,
      // Sifreli blob BICIMINDE sahte deger: testin sordugu sey yanita
      // cikip cikmadigi, sifrenin kendisi degil.
      taxIdentifier: `v1:iv:tag:S41-GIZLI-BLOB-${KOSU}`,
      taxLast4: '9999',
      status: SellerStatus.UNDER_REVIEW,
      verification: SellerVerification.BEKLIYOR,
      ...ek,
    },
  });
  return s.id;
}

/** Salt-okuma kaniti icin DB anlik goruntusu (JSON; Date/BigInt metne cevrilir). */
async function anlikGoruntu() {
  const kullanicilar = [sahipA, sahipB, sahipSilik];
  const saticilar = [saticiA, saticiB, saticiSilik];
  const veri = {
    saticilar: await prisma.seller.findMany({ where: { id: { in: saticilar } }, orderBy: { id: 'asc' } }),
    kullanicilar: await prisma.user.findMany({ where: { id: { in: kullanicilar } }, orderBy: { id: 'asc' } }),
    roller: await prisma.userRole.findMany({ where: { userId: { in: kullanicilar } }, orderBy: { id: 'asc' } }),
    magazaSayisi: await prisma.store.count({ where: { OR: [{ ownerId: { in: kullanicilar } }, { sellerId: { in: saticilar } }] } }),
    belgeler: await prisma.saticiBelge.findMany({ where: { sellerId: { in: saticilar } }, orderBy: { id: 'asc' } }),
    sozlesmeler: await prisma.sozlesmeOnay.findMany({ where: { kullaniciId: { in: kullanicilar } }, orderBy: { id: 'asc' } }),
  };
  return JSON.stringify(veri, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

// ==================================================================== kurulum

beforeAll(async () => {
  const url = testVeritabaniUrl();
  prisma = new PrismaService({ datasources: { db: { url } } });
  await prisma.$connect();

  guard = new PermissionsGuard(new Reflector(), new IzinMatrisi(prisma));
  // GERCEK SozlesmeService: detay ona dokunsaydi aktif surum olmadigi icin
  // gercek 503 firlatirdi.
  market = new MarketService(
    prisma,
    {} as unknown as AuditService,
    {} as unknown as SellerStatusService,
    new SozlesmeService(prisma),
  );

  // passwordHash DOLU: projeksiyon hatasi olsaydi yanita sizardi.
  sahipA = await kullaniciKur('sahipA', [Role.CUSTOMER], { passwordHash: `S41-GIZLI-HASH-${KOSU}`, email: `s41a-${KOSU}@ornek.com` });
  sahipB = await kullaniciKur('sahipB', [Role.CUSTOMER]);
  sahipSilik = await kullaniciKur('sahipSilik', [Role.CUSTOMER]);

  saticiA = await saticiKur(sahipA);
  saticiB = await saticiKur(sahipB);
  saticiSilik = await saticiKur(sahipSilik, { deletedAt: new Date() });

  await prisma.saticiBelge.createMany({
    data: [
      { sellerId: saticiA, tip: SaticiBelgeTipi.VERGI_LEVHASI, dosyaUrl: `https://x/${KOSU}/a-aktif-1.pdf` },
      {
        sellerId: saticiA, tip: SaticiBelgeTipi.KIMLIK, dosyaUrl: `https://x/${KOSU}/a-aktif-2.pdf`,
        durum: SaticiBelgeDurum.REDDEDILDI, redGerekce: 'Okunaksiz',
      },
      { sellerId: saticiA, tip: SaticiBelgeTipi.DIGER, dosyaUrl: `https://x/${KOSU}/a-silik.pdf`, deletedAt: new Date() },
      { sellerId: saticiB, tip: SaticiBelgeTipi.VERGI_LEVHASI, dosyaUrl: `https://x/${KOSU}/b-aktif.pdf` },
    ],
  });

  const onay = (kullaniciId: string, sozlesmeTipi: SozlesmeTipi) => ({
    kullaniciId, sozlesmeTipi, surum: `s41-${KOSU}`, metinHash: 'b'.repeat(64),
    ip: '10.9.9.9', cihaz: `S41-CIHAZ-${KOSU}`,
  });
  await prisma.sozlesmeOnay.createMany({
    data: [
      onay(sahipA, SozlesmeTipi.SATICI),
      onay(sahipA, SozlesmeTipi.SATICI_KOMISYON),
      onay(sahipA, SozlesmeTipi.TASIYICI),
      onay(sahipB, SozlesmeTipi.SATICI),
    ],
  });
});

afterAll(async () => {
  if (!prisma) return;
  testVeritabaniUrl(); // DEFENSE IN DEPTH

  if (olusanKullanicilar.length > 0) {
    const saticilar = await prisma.seller.findMany({
      where: { ownerUserId: { in: olusanKullanicilar } }, select: { id: true },
    });
    await prisma.saticiBelge.deleteMany({ where: { sellerId: { in: saticilar.map((s) => s.id) } } });
    await prisma.sozlesmeOnay.deleteMany({ where: { kullaniciId: { in: olusanKullanicilar } } });
    await prisma.seller.deleteMany({ where: { ownerUserId: { in: olusanKullanicilar } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: olusanKullanicilar } } });
    await prisma.user.deleteMany({ where: { id: { in: olusanKullanicilar } } });
  }
  await prisma.$disconnect();
});

// ===================================================================== testler

describe('S4.1 — uc metadata\'si (GERCEK dekoratorler)', () => {
  it('GET sellers/:id', () => {
    expect(Reflect.getMetadata(PATH_METADATA, HANDLER)).toBe('sellers/:id');
    expect(Reflect.getMetadata(METHOD_METADATA, HANDLER)).toBe(RequestMethod.GET);
  });

  it('JwtAuthGuard + PermissionsGuard uc uzerinde (401 kapisi)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, HANDLER)).toEqual([JwtAuthGuard, PermissionsGuard]);
  });

  it('store:manage:all istiyor', () => {
    const istenen = new Reflector().getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [HANDLER, MarketController]);
    expect(istenen).toEqual([Permission.STORE_MANAGE_ALL]);
  });

  it(':id parametresine UuidParam bagli', () => {
    const argumanlar = Reflect.getMetadata(ROUTE_ARGS_METADATA, MarketController, 'saticiDetay') as Record<
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

describe('S4.1 — yetki kapisi (GERCEK izin matrisi)', () => {
  it.each([[Role.ADMIN], [Role.SUPER_ADMIN]])('%s gecer', async (rol) => {
    const userId = await kullaniciKur(`yetkili-${rol}`, [rol]);
    await expect(guard.canActivate(ctxUret({ id: userId, roles: [rol] }))).resolves.toBe(true);
  });

  it('CUSTOMER 403 alir', async () => {
    const userId = await kullaniciKur('customer', [Role.CUSTOMER]);
    await expect(guard.canActivate(ctxUret({ id: userId, roles: [Role.CUSTOMER] }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('S4.1 — gercek DB projeksiyonu ve kapsam', () => {
  it('gizli alanlar DOLU iken yanita cikmaz; owner allow-list, telefon TAM', async () => {
    const onKosul = await prisma.user.findUniqueOrThrow({ where: { id: sahipA } });
    expect(onKosul.passwordHash).toBe(`S41-GIZLI-HASH-${KOSU}`);

    const r = await market.saticiDetay([Role.ADMIN], saticiA);

    const metin = JSON.stringify(r);
    expect(metin).not.toContain('S41-GIZLI-BLOB');
    expect(metin).not.toContain('S41-GIZLI-HASH');
    expect(metin).not.toContain(`s41a-${KOSU}@ornek.com`);
    expect(r.seller).not.toHaveProperty('taxIdentifier');
    expect(r.seller).not.toHaveProperty('ownerUserId');
    expect(r.seller).not.toHaveProperty('deletedAt');
    expect(r.seller.taxLast4).toBe('9999');
    expect(r.seller.status).toBe(SellerStatus.UNDER_REVIEW);
    expect(Object.keys(r.owner).sort()).toEqual(['id', 'name', 'phone', 'status', 'surname']);
    expect(r.owner.id).toBe(sahipA);
    expect(r.owner.phone).toBe(onKosul.phone);
  });

  it('yalnizca istenen saticinin AKTIF belgeleri doner (createdAt desc)', async () => {
    const r = await market.saticiDetay([Role.ADMIN], saticiA);

    const urller = r.belgeler.map((b) => b.dosyaUrl).sort();
    expect(urller).toEqual([`https://x/${KOSU}/a-aktif-1.pdf`, `https://x/${KOSU}/a-aktif-2.pdf`]);
    const reddedilen = r.belgeler.find((b) => b.dosyaUrl.endsWith('a-aktif-2.pdf'))!;
    expect(reddedilen.redGerekce).toBe('Okunaksiz');
    for (const b of r.belgeler) {
      expect(Object.keys(b).sort()).toEqual(['createdAt', 'dosyaUrl', 'durum', 'id', 'redGerekce', 'tip', 'updatedAt']);
    }
    const tarihler = r.belgeler.map((b) => b.createdAt.getTime());
    expect(tarihler).toEqual([...tarihler].sort((x, y) => y - x));
  });

  it('soft-delete edilmis satici 404', async () => {
    await expect(market.saticiDetay([Role.ADMIN], saticiSilik)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('var olmayan satici 404', async () => {
    await expect(market.saticiDetay([Role.ADMIN], randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sozlesme: yalnizca owner\'in SATICI/SATICI_KOMISYON onaylari; TASIYICI ve baska kullanici YOK; ip/cihaz YOK', async () => {
    const r = await market.saticiDetay([Role.ADMIN], saticiA);

    expect(r.sozlesmeOnaylari.map((s) => s.sozlesmeTipi).sort()).toEqual(
      [SozlesmeTipi.SATICI, SozlesmeTipi.SATICI_KOMISYON].sort(),
    );
    for (const s of r.sozlesmeOnaylari) {
      expect(Object.keys(s).sort()).toEqual(['metinHash', 'onayTarihi', 'sozlesmeTipi', 'surum']);
    }
    const metin = JSON.stringify(r);
    expect(metin).not.toContain('10.9.9.9');
    expect(metin).not.toContain('S41-CIHAZ');
  });

  it('aktif SATICI_KOMISYON surumu YOKKEN detay basarili (503 tuzagi yok)', async () => {
    // ON KOSUL ARTIK KURULUYOR, VARSAYILMIYOR: 02'de EK-4 komisyon tarifesi
    // migration ile yayinlandi, yani migrate edilmis bir DB'de aktif surum
    // ARTIK VAR. Testin korudugu davranis (detay ucu SozlesmeService'in
    // 503'une takilmamali) degismedi; iddia GEVSETILMEDI - yokluk gecici
    // olarak yaratilip sonunda aynen geri aliniyor.
    const aktifler = await prisma.sozlesmeVersiyon.findMany({
      where: { tip: SozlesmeTipi.SATICI_KOMISYON, aktif: true }, select: { id: true },
    });
    const idler = aktifler.map((v) => v.id);
    await prisma.sozlesmeVersiyon.updateMany({ where: { id: { in: idler } }, data: { aktif: false } });
    try {
      expect(await prisma.sozlesmeVersiyon.count({
        where: { tip: SozlesmeTipi.SATICI_KOMISYON, aktif: true },
      })).toBe(0);

      await expect(market.saticiDetay([Role.ADMIN], saticiA)).resolves.toBeDefined();
    } finally {
      await prisma.sozlesmeVersiyon.updateMany({ where: { id: { in: idler } }, data: { aktif: true } });
    }
  });

  it('0 belge / 0 sozlesme -> bos diziler', async () => {
    const sahip = await kullaniciKur('bos', [Role.CUSTOMER]);
    const satici = await saticiKur(sahip);

    const r = await market.saticiDetay([Role.SUPER_ADMIN], satici);

    expect(r.belgeler).toEqual([]);
    expect(r.sozlesmeOnaylari).toEqual([]);
    expect(r.inceleme).toEqual({ belgeSuresiGecti: false, durumTutarsiz: false, bekleyenGunSayisi: 0 });
  });
});

describe('S4.1 — SALT OKUMA (gercek DB anlik goruntusu)', () => {
  it('detay cagrilari oncesi/sonrasi Seller, kullanici, user_roles, Store, belgeler, sozlesme_onaylari AYNI', async () => {
    const once = await anlikGoruntu();

    await market.saticiDetay([Role.ADMIN], saticiA);
    await market.saticiDetay([Role.SUPER_ADMIN], saticiB);
    await expect(market.saticiDetay([Role.ADMIN], saticiSilik)).rejects.toBeInstanceOf(NotFoundException);

    expect(await anlikGoruntu()).toBe(once);
  });
});
