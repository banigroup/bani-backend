// T12 — POST /market/seller YETKI KAPISI. GERCEK PostgreSQL GEREKTIRIR.
//
// NE KANITLIYOR: ucun UZERINDEKI dekorator + gercek PermissionsGuard + gercek
// izin matrisi (role_permissions tablosu) BIRLIKTE 403 uretiyor mu.
//
// NEDEN SAHTE REFLECTOR KULLANILMIYOR: repodaki mevcut desen
// (test-izin-matrisi.js) guard'a elle bir izin listesi veriyor - o, GUARD'in
// dogru calistigini kanitlar ama UCUN dogru dekoratoru tasidigini KANITLAMAZ.
// Dekorator yanlis izne baglansa ya da hic konmasa o test yine yesil kalirdi.
// Burada @nestjs/core'un GERCEK Reflector'u, GERCEK MarketController metodunun
// metadata'sini okuyor; yani "uc korumasiz kaldi" hatasi bu testi dusurur.
//
// NEDEN HTTP HARNESS DEGIL: repoda supertest / @nestjs/testing YOK. Bunlari
// eklemek yeni bir bagimlilik ve lockfile degisikligi demekti - S2'nin kapsami
// disinda. Guard, Nest'te istegin ucun govdesine ulasmadan once gectigi TEK
// kapidir; dolayisiyla bu seviye "403 doner" iddiasini tam olarak kanitlar.
//
// CALISTIRMA: `pnpm run test:int` + INTEGRATION_DATABASE_URL (bani_test).
// FAIL-CLOSED: hedef veritabani 'bani_test' degilse HICBIR baglanti kurulmaz.
import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { BusinessUnit, Role, SellerType } from '@prisma/client';
import { MarketController } from './market.controller';
import { CreateSaticiDto } from './dto/seller.dto';
import { IzinMatrisi } from '../common/rbac/izin-matrisi.service';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { Permission } from '../common/rbac/permissions.enum';
import { PERMISSIONS_KEY } from '../common/rbac/permissions.decorator';
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

let prisma: PrismaService;
let matris: IzinMatrisi;
let guard: PermissionsGuard;

const olusanKullanicilar: string[] = [];

/** UCUN GERCEK metodu — dekorator metadata'si bunun uzerinde durur. */
const HANDLER = MarketController.prototype.saticiOlustur;

/**
 * Nest'in ExecutionContext'i. getHandler/getClass GERCEK sinif ve metodu
 * doner ki Reflector uctaki dekoratoru okuyabilsin.
 *
 * handler VARSAYILANLI: S3'te ayni harness dort basvuru ucu ve
 * POST /market/stores icin de kullaniliyor; mevcut T12 testleri degismeden
 * calismaya devam ediyor.
 */
function ctxUret(user: unknown, handler: unknown = HANDLER) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler,
    getClass: () => MarketController,
  } as never;
}

/** Uctaki GERCEK dekorator metadata'sini okur (elle liste verilmez). */
function ucunIstedigiIzinler(handler: unknown): Permission[] | undefined {
  return new Reflector().getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
    handler as never,
    MarketController as never,
  ]);
}

// SAYAC: ayni etiket birden fazla kez kullanilabiliyor (it.each dort ucu ayni
// etiketle dolasiyor) ve users.phone UNIQUE. Etikete guvenmek yerine her cagri
// kendi numarasini alir - boylece ileride eklenen testler de bu tuzaga dusmez.
let kullaniciSayaci = 0;

async function kullaniciKur(etiket: string, roller: Role[]): Promise<string> {
  kullaniciSayaci += 1;
  const kullanici = await prisma.user.create({
    data: { phone: `T12-${KOSU}-${kullaniciSayaci}-${etiket}`, name: `T12 ${etiket}` },
  });
  olusanKullanicilar.push(kullanici.id);
  if (roller.length > 0) {
    await prisma.userRole.createMany({
      data: roller.map((role) => ({ userId: kullanici.id, role, storeId: null })),
    });
  }
  return kullanici.id;
}

function gecerliGovde() {
  return {
    yetkiliAdSoyad: 'Ayse Yilmaz',
    basvuruEposta: `t12-${KOSU}@ornek.com`,
    legalName: `T12 Unvan ${KOSU}`,
    displayName: `T12 Ad ${KOSU}`,
    sellerType: SellerType.MARKET,
    talepEdilenDikey: BusinessUnit.MARKET,
  };
}

// ==================================================================== kurulum

beforeAll(async () => {
  const url = testVeritabaniUrl();
  prisma = new PrismaService({ datasources: { db: { url } } });
  await prisma.$connect();

  // GERCEK matris: role_permissions tablosundan okur (sahte harita YOK).
  matris = new IzinMatrisi(prisma);
  // GERCEK Reflector: uctaki @RequirePermissions metadata'sini okur.
  guard = new PermissionsGuard(new Reflector(), matris);
});

afterAll(async () => {
  if (!prisma) return;
  testVeritabaniUrl(); // DEFENSE IN DEPTH

  if (olusanKullanicilar.length > 0) {
    await prisma.seller.deleteMany({ where: { ownerUserId: { in: olusanKullanicilar } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: olusanKullanicilar } } });
    await prisma.user.deleteMany({ where: { id: { in: olusanKullanicilar } } });
  }
  await prisma.$disconnect();
});

// ===================================================================== testler

describe('T12 — POST /market/seller yetki kapisi', () => {
  it('ucun dekoratoru SELLER_APPLY istiyor (metadata gercekten uzerinde)', () => {
    const istenen = new Reflector().getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      HANDLER,
      MarketController,
    ]);
    // Dekorator hic konmasaydi undefined donerdi ve guard ucu SERBEST birakirdi;
    // bu assert o sessiz basarisizligi yakalar.
    expect(istenen).toEqual([Permission.SELLER_APPLY]);
  });

  it('seller:apply OLMAYAN kimlikli kullanici 403 alir', async () => {
    // COURIER seciliyor: kimlik dogrulanmis GERCEK bir rol ama izin matrisinde
    // seller:apply YOK. "Rolsuz kullanici" ile test etmek daha zayif olurdu -
    // bu, izin eksikligini rolsuzlukten ayirir.
    const userId = await kullaniciKur('izinsiz', [Role.COURIER]);

    await expect(
      guard.canActivate(ctxUret({ id: userId, roles: [Role.COURIER] })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Guard govdeye ULASMADAN durdurdugu icin hicbir yan etki olmamali.
    expect(await prisma.seller.count({ where: { ownerUserId: userId } })).toBe(0);
    expect(await prisma.store.count({ where: { ownerId: userId } })).toBe(0);
  });

  it('CUSTOMER (seller:apply SAHIBI) gecer — testin dogru sebeple dustugu kaniti', async () => {
    // Bu assert olmasaydi test "her kullanici 403 aliyor" gibi yanlis bir
    // dunyada da yesil kalirdi. S1 matris satiri (CUSTOMER -> seller:apply)
    // burada uctan uca dogrulanmis oluyor.
    const userId = await kullaniciKur('izinli', [Role.CUSTOMER]);

    await expect(
      guard.canActivate(ctxUret({ id: userId, roles: [Role.CUSTOMER] })),
    ).resolves.toBe(true);
  });

  it('MERCHANT de gecer (S1 regresyon korumasi satiri)', async () => {
    const userId = await kullaniciKur('merchant', [Role.MERCHANT]);

    await expect(
      guard.canActivate(ctxUret({ id: userId, roles: [Role.MERCHANT] })),
    ).resolves.toBe(true);
  });

  it('403 sebebi IZIN eksikligidir, DTO dogrulamasi DEGIL', async () => {
    // Gate sarti: test permission yuzunden dusmeli, 400 yuzunden degil.
    // Ayni govde uretimdeki ValidationPipe'tan SORUNSUZ geciyor.
    const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
    await expect(
      pipe.transform(gecerliGovde(), { type: 'body', metatype: CreateSaticiDto }),
    ).resolves.toBeDefined();
  });
});

// ============================================================================
// S3 — BASVURU YAZMA UCLARININ IZNI: STORE_WRITE -> SELLER_APPLY
// ----------------------------------------------------------------------------
// NE OLCULUYOR: ucun UZERINDEKI dekorator + gercek PermissionsGuard + gercek
// izin matrisi (role_permissions tablosu) birlikte hangi rolu geciriyor.
//
// Bu paket IS SONUCUNU degil YETKI KAPISINI olcer: guard, istegin uc govdesine
// ulasmadan once gectigi TEK kapidir, dolayisiyla "403 doner" iddiasi burada
// tam olarak kanitlanir. Govdelerin kendi davranisi (durum gecisi, belge
// kaydi, sozlesme onayi) ilgili servis testlerinin isi.
// ============================================================================

/** S3 kapsamindaki dort basvuru YAZMA ucu. */
const BASVURU_YAZMA_UCLARI = [
  { ad: 'PATCH /market/seller', handler: MarketController.prototype.saticiGuncelle },
  { ad: 'POST /market/seller/submit', handler: MarketController.prototype.saticiOnayaGonder },
  { ad: 'POST /market/seller/belge', handler: MarketController.prototype.belgeYukle },
  { ad: 'POST /market/seller/sozlesme/onayla', handler: MarketController.prototype.saticiSozlesmeOnayla },
] as const;

describe('S3 — basvuru yazma uclari SELLER_APPLY istiyor', () => {
  it.each(BASVURU_YAZMA_UCLARI)('$ad dekoratoru SELLER_APPLY tasiyor', ({ handler }) => {
    // Dekorator kaldirilsa undefined donerdi ve guard ucu SERBEST birakirdi;
    // STORE_WRITE'a geri alinsa bu assert duserdi. Iki sessiz basarisizligi da
    // yakalar.
    expect(ucunIstedigiIzinler(handler)).toEqual([Permission.SELLER_APPLY]);
  });

  it.each(BASVURU_YAZMA_UCLARI)('$ad: CUSTOMER (seller:apply) GECER', async ({ handler }) => {
    const userId = await kullaniciKur('s3-customer', [Role.CUSTOMER]);
    await expect(
      guard.canActivate(ctxUret({ id: userId, roles: [Role.CUSTOMER] }, handler)),
    ).resolves.toBe(true);
  });

  it.each(BASVURU_YAZMA_UCLARI)('$ad: MERCHANT GECER (regresyon korumasi)', async ({ handler }) => {
    // S1'de MERCHANT'a seller:apply satiri BU AN icin eklenmisti: izin
    // STORE_WRITE'tan cevrilince mevcut saticilar kendi KYC/basvuru verilerini
    // yonetemez hale gelecekti. Bu test o regresyonu kalici olarak kapatir.
    const userId = await kullaniciKur('s3-merchant', [Role.MERCHANT]);
    await expect(
      guard.canActivate(ctxUret({ id: userId, roles: [Role.MERCHANT] }, handler)),
    ).resolves.toBe(true);
  });

  it.each(BASVURU_YAZMA_UCLARI)('$ad: COURIER (seller:apply YOK) 403 alir', async ({ handler }) => {
    // COURIER seciliyor: kimligi dogrulanmis GERCEK bir rol ama matriste ne
    // seller:apply ne store:write var. Rolsuz kullaniciyla test etmek daha
    // zayif olurdu - bu, izin eksikligini rolsuzlukten ayirir.
    const userId = await kullaniciKur('s3-courier', [Role.COURIER]);
    await expect(
      guard.canActivate(ctxUret({ id: userId, roles: [Role.COURIER] }, handler)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('S3 — GUVENLIK SINIRI: SELLER_APPLY magaza yonetimini ACMAZ', () => {
  const magazaYarat = MarketController.prototype.create; // POST /market/stores

  it('POST /market/stores dekoratoru STORE_WRITE tasimaya DEVAM ediyor', () => {
    // S3 bu ucu DEGISTIRMEDI. Yanlislikla SELLER_APPLY'a cevrilse onaysiz
    // kullaniciya magaza acma yolu acilirdi.
    expect(ucunIstedigiIzinler(magazaYarat)).toEqual([Permission.STORE_WRITE]);
  });

  it('CUSTOMER, seller:apply SAHIBI olmasina ragmen POST /market/stores 403 alir', async () => {
    // S3'UN EN KRITIK TESTI: basvuru yuzeyini acmak magaza yonetimini
    // ACMAMALI. CUSTOMER'da store:write YOK; dolayisiyla dort basvuru ucunu
    // gecen ayni kullanici bu ucta durdurulur.
    const userId = await kullaniciKur('s3-sinir', [Role.CUSTOMER]);

    await expect(
      guard.canActivate(ctxUret({ id: userId, roles: [Role.CUSTOMER] }, magazaYarat)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('MERCHANT POST /market/stores gecer (mevcut yetki bozulmadi)', async () => {
    const userId = await kullaniciKur('s3-sinir-merchant', [Role.MERCHANT]);
    await expect(
      guard.canActivate(ctxUret({ id: userId, roles: [Role.MERCHANT] }, magazaYarat)),
    ).resolves.toBe(true);
  });
});
