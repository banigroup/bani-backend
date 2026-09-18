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
 */
function ctxUret(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => HANDLER,
    getClass: () => MarketController,
  } as never;
}

async function kullaniciKur(etiket: string, roller: Role[]): Promise<string> {
  const kullanici = await prisma.user.create({
    data: { phone: `T12-${KOSU}-${etiket}`, name: `T12 ${etiket}` },
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
