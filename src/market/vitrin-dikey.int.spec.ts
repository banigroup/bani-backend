// VERT-02 / P1 — PUBLIC VITRIN IZOLASYONU — ENTEGRASYON. GERCEK PostgreSQL GEREKTIRIR.
//
// NE KANITLIYOR (gercek servis yollari, gercek sorgular):
//   V1  dogru dikey magazasi gorunur; yanlis dikey 404
//   V2  dikeysiz istekte de kapali magaza gizli
//   V3  askiya alinmis saticinin magazasi gizli
//   V4  aktif ama gosterilebilir urunu olmayan magaza gizli; urun onaylaninca gorunur
//   V5  stogu sifir urun tek basina magazayi gizlemez
//   V6  yanlis dikeyin urunu dogrudan id ile acilmaz
//   V7  kapali magazanin urun ve kategorileri gorunmez
//   V8  satici kendi kapali/urunsuz magazasini yetkili uctan gorur; baska satici 403
//   V9  ic getById kapali magazayi hala bulur (yetki kapilari icin degismedi)
//   V10 kapali magazada public 404, satici yonetim urun listesi + kategori agaci okunur
//   V11 urunsuz magaza ve ACTIVE olmayan satici yonetim verisini okur
//   V12 yonetim uclarinda personel / baska satici / dikey / admin yetki sozlesmesi
//
// CALISTIRMA: `pnpm run test:int` + INTEGRATION_DATABASE_URL (bani_test).
// FAIL-CLOSED: hedef veritabani 'bani_test' degilse HICBIR baglanti kurulmaz.
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BusinessUnit, Role, SellerStatus, SellerType, SellerVerification, UserStatus } from '@prisma/client';
import { MarketService } from './market.service';
import { SellerStatusService } from './seller-status.service';
import { AuditService } from '../common/audit/audit.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { CatalogService } from '../catalog/catalog.service';
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
const { MARKET, YEMEK } = BusinessUnit;
const MERCHANT = [Role.CUSTOMER, Role.MERCHANT];

let prisma: PrismaService;
let market: MarketService;
let catalog: CatalogService;

const olusanKullanicilar: string[] = [];
let sayac = 0;

async function kullaniciKur(etiket: string, roller: Role[]): Promise<string> {
  sayac += 1;
  const k = await prisma.user.create({
    data: { phone: `V02-${KOSU}-${sayac}-${etiket}`, name: `V02 ${etiket}`, surname: 'Test', status: UserStatus.ACTIVE },
  });
  olusanKullanicilar.push(k.id);
  if (roller.length > 0) {
    await prisma.userRole.createMany({ data: roller.map((role) => ({ userId: k.id, role, storeId: null })) });
  }
  return k.id;
}

type Magaza = { sahip: string; sellerId: string; storeId: string; slug: string };

/** GERCEK ilk magaza kurulumu (ACTIVE satici, dikey talepEdilenDikey'den). Urun EKLENMEZ. */
async function magazaKur(dikey: BusinessUnit, etiket: string): Promise<Magaza> {
  const sahip = await kullaniciKur(`sahip-${etiket}`, MERCHANT);
  const s = await prisma.seller.create({
    data: {
      ownerUserId: sahip, sellerType: SellerType.MARKET,
      legalName: `V02 Unvan ${KOSU}`, displayName: `V02 Ad ${KOSU}`,
      talepEdilenDikey: dikey, status: SellerStatus.ACTIVE, verification: SellerVerification.ONAYLANDI,
    },
  });
  const m = await market.create(sahip, { name: `V02 ${KOSU} ${etiket}` }, '10.0.2.1');
  return { sahip, sellerId: s.id, storeId: m.id, slug: m.slug };
}

async function urunKur(storeId: string, etiket: string, veri: { isActive?: boolean; stock?: number; categoryId?: string } = {}) {
  const u = await prisma.product.create({
    data: {
      storeId, name: `V02 urun ${etiket}`, slug: `v02-${KOSU}-${etiket}`, price: 1000n,
      isActive: veri.isActive ?? true, stock: veri.stock ?? 5, categoryId: veri.categoryId,
    },
  });
  return u.id;
}

async function listedeMi(storeId: string, dikey: BusinessUnit | null): Promise<boolean> {
  return (await market.listActive(0, 100, dikey)).some((s) => s.id === storeId);
}

let M: Magaza; // MARKET, aktif urunlu
let Y: Magaza; // YEMEK, aktif urunlu
let urunM: string;
let urunY: string;
let admin: string;

// ==================================================================== kurulum

beforeAll(async () => {
  const url = testVeritabaniUrl();
  prisma = new PrismaService({ datasources: { db: { url } } });
  await prisma.$connect();
  market = new MarketService(prisma, new AuditService(prisma), new SellerStatusService(), new SozlesmeService(prisma));
  catalog = new CatalogService(prisma, market);

  admin = await kullaniciKur('admin', [Role.ADMIN]);
  M = await magazaKur(MARKET, 'm');
  Y = await magazaKur(YEMEK, 'y');
  urunM = await urunKur(M.storeId, 'm');
  urunY = await urunKur(Y.storeId, 'y');
});

afterAll(async () => {
  if (!prisma) return;
  testVeritabaniUrl(); // DEFENSE IN DEPTH

  if (olusanKullanicilar.length > 0) {
    const saticilar = (await prisma.seller.findMany({ where: { ownerUserId: { in: olusanKullanicilar } }, select: { id: true } }))
      .map((s) => s.id);
    const magazaIdleri = (await prisma.store.findMany({ where: { sellerId: { in: saticilar } }, select: { id: true } }))
      .map((m) => m.id);
    await prisma.product.deleteMany({ where: { storeId: { in: magazaIdleri } } });
    await prisma.category.deleteMany({ where: { storeId: { in: magazaIdleri } } });
    await prisma.auditLog.deleteMany({ where: { entity: 'Store', entityId: { in: magazaIdleri } } });
    await prisma.userRole.deleteMany({ where: { OR: [{ userId: { in: olusanKullanicilar } }, { storeId: { in: magazaIdleri } }] } });
    await prisma.store.deleteMany({ where: { id: { in: magazaIdleri } } });
    await prisma.seller.deleteMany({ where: { id: { in: saticilar } } });
    await prisma.user.deleteMany({ where: { id: { in: olusanKullanicilar } } });
  }
  await prisma.$disconnect();
});

// ===================================================================== testler

describe('VERT-02 — V1 dikey eslesmesi', () => {
  it('dogru dikey 200 (id + slug + liste); yanlis dikey 404 / listede yok', async () => {
    await expect(market.getPublicById(M.storeId, MARKET)).resolves.toMatchObject({ id: M.storeId });
    await expect(market.getBySlug(M.slug, MARKET)).resolves.toMatchObject({ id: M.storeId });
    expect(await listedeMi(M.storeId, MARKET)).toBe(true);

    await expect(market.getPublicById(M.storeId, YEMEK)).rejects.toBeInstanceOf(NotFoundException);
    await expect(market.getBySlug(M.slug, YEMEK)).rejects.toBeInstanceOf(NotFoundException);
    expect(await listedeMi(M.storeId, YEMEK)).toBe(false);
    expect(await listedeMi(Y.storeId, YEMEK)).toBe(true);
  });

  it('dikeysiz istek: aktif urunlu magazalar dikeyden bagimsiz gorunur', async () => {
    await expect(market.getPublicById(M.storeId, null)).resolves.toMatchObject({ id: M.storeId });
    expect(await listedeMi(M.storeId, null)).toBe(true);
    expect(await listedeMi(Y.storeId, null)).toBe(true);
  });

  it('gecersiz ?dikey= -> 400 DIKEY_GECERSIZ', () => {
    expect(() => market.vitrinDikeyi('KAHVE')).toThrow(BadRequestException);
  });
});

describe('VERT-02 — V2/V3 aktiflik ve satici durumu (dikeysiz de)', () => {
  it('V2: kapali magaza dikeysiz istekte de gizli (liste + id + slug)', async () => {
    const k = await magazaKur(MARKET, 'kapali');
    await urunKur(k.storeId, 'kapali');
    expect(await listedeMi(k.storeId, null)).toBe(true);
    await prisma.store.update({ where: { id: k.storeId }, data: { isActive: false } });
    expect(await listedeMi(k.storeId, null)).toBe(false);
    await expect(market.getPublicById(k.storeId, null)).rejects.toBeInstanceOf(NotFoundException);
    await expect(market.getBySlug(k.slug, null)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('V3: askiya alinmis saticinin magazasi gizli', async () => {
    const a = await magazaKur(MARKET, 'aski');
    await urunKur(a.storeId, 'aski');
    await prisma.seller.update({ where: { id: a.sellerId }, data: { status: SellerStatus.SUSPENDED } });
    expect(await listedeMi(a.storeId, null)).toBe(false);
    expect(await listedeMi(a.storeId, MARKET)).toBe(false);
    await expect(market.getPublicById(a.storeId, null)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('VERT-02 — V4/V5 urun varligi', () => {
  it('V4: urunsuz ve yalniz onay bekleyen urunlu magaza gizli; urun onaylaninca gorunur', async () => {
    const u = await magazaKur(MARKET, 'urunsuz');
    expect(await listedeMi(u.storeId, null)).toBe(false);
    await expect(market.getPublicById(u.storeId, MARKET)).rejects.toBeInstanceOf(NotFoundException);

    const bekleyen = await urunKur(u.storeId, 'bekleyen', { isActive: false });
    expect(await listedeMi(u.storeId, null)).toBe(false);

    await catalog.approveProduct(bekleyen, admin, [Role.ADMIN]); // gercek onay yolu
    expect(await listedeMi(u.storeId, MARKET)).toBe(true);
    await expect(market.getPublicById(u.storeId, MARKET)).resolves.toMatchObject({ id: u.storeId });
  });

  it('V5: yalniz stogu sifir aktif urun -> magaza GORUNUR', async () => {
    const s = await magazaKur(MARKET, 'stoksuz');
    await urunKur(s.storeId, 'stoksuz', { stock: 0 });
    expect(await listedeMi(s.storeId, null)).toBe(true);
    await expect(market.getPublicById(s.storeId, MARKET)).resolves.toMatchObject({ id: s.storeId });
  });
});

describe('VERT-02 — V6/V7 katalog public okumalari', () => {
  it('V6: yanlis dikeyin urunu dogrudan id ile acilmaz; dogru dikey ve dikeysiz acilir', async () => {
    await expect(catalog.getPublicProduct(urunM, YEMEK)).rejects.toBeInstanceOf(NotFoundException);
    await expect(catalog.getPublicProduct(urunM, MARKET)).resolves.toMatchObject({ id: urunM });
    await expect(catalog.getPublicProduct(urunY, null)).resolves.toMatchObject({ id: urunY });
    await expect(catalog.listProducts(M.storeId, undefined, 0, 50, YEMEK)).rejects.toBeInstanceOf(NotFoundException);
    await expect(catalog.listCategories(M.storeId, false, YEMEK)).rejects.toBeInstanceOf(NotFoundException);
    expect((await catalog.listProducts(M.storeId, undefined, 0, 50, MARKET)).map((p) => p.id)).toEqual([urunM]);
  });

  it('V7: kapali magazanin urunleri ve kategorileri gorunmez (id ile de)', async () => {
    const k = await magazaKur(MARKET, 'kapali-katalog');
    const kat = await prisma.category.create({ data: { storeId: k.storeId, name: 'V02 kat', slug: `v02-${KOSU}-kat` } });
    const urun = await urunKur(k.storeId, 'kapali-katalog', { categoryId: kat.id });
    // Kapanmadan once gorunur (karsilastirma tabani).
    await expect(catalog.getPublicProduct(urun, null)).resolves.toMatchObject({ id: urun });
    expect((await catalog.listCategories(k.storeId, false, null)).map((c: any) => c.id)).toEqual([kat.id]);

    await prisma.store.update({ where: { id: k.storeId }, data: { isActive: false } });
    await expect(catalog.getPublicProduct(urun, null)).rejects.toBeInstanceOf(NotFoundException);
    await expect(catalog.listProducts(k.storeId, undefined, 0, 50, null)).rejects.toBeInstanceOf(NotFoundException);
    await expect(catalog.listCategories(k.storeId, false, null)).rejects.toBeInstanceOf(NotFoundException);
    await expect(catalog.listCategories(k.storeId, true, null)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('VERT-02 — V8/V9 satici paneli ve ic getById', () => {
  it('V8: satici kendi kapali ve urunsuz magazasini yetkili uctan gorur; baska satici 403', async () => {
    const p = await magazaKur(MARKET, 'panel');
    await prisma.store.update({ where: { id: p.storeId }, data: { isActive: false } });
    await expect(market.getPublicById(p.storeId, MARKET)).rejects.toBeInstanceOf(NotFoundException);

    await expect(market.panelMagaza(p.storeId, p.sahip, MERCHANT, MARKET)).resolves.toMatchObject({ id: p.storeId, isActive: false });
    await expect(market.panelMagaza(p.storeId, M.sahip, MERCHANT, MARKET)).rejects.toBeInstanceOf(ForbiddenException);
    // VERT-01 kapisi korunur.
    await expect(market.panelMagaza(p.storeId, p.sahip, MERCHANT, null)).rejects.toBeInstanceOf(BadRequestException);
    await expect(market.panelMagaza(p.storeId, p.sahip, MERCHANT, YEMEK)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(market.panelMagaza(p.storeId, admin, [Role.ADMIN], null)).resolves.toMatchObject({ id: p.storeId });
  });

  it('V9: ic getById kapali/urunsuz magazayi bulur; sahibin yonetim kapisi calisir', async () => {
    const i = await magazaKur(MARKET, 'ic');
    await prisma.store.update({ where: { id: i.storeId }, data: { isActive: false } });
    await expect(market.getById(i.storeId)).resolves.toMatchObject({ id: i.storeId, isActive: false });
    await expect(market.calismaSaatleri(i.storeId, i.sahip, MERCHANT, MARKET)).resolves.toBeDefined();
    await expect(market.calismaSaatleri(i.storeId, M.sahip, MERCHANT, MARKET)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('VERT-02 — V10-V12 satici yonetim urun listesi ve kategori agaci', () => {
  it('V10: kapali magazada public 404, yonetim okur (yayindaki + pending + bos kategori dahil agac)', async () => {
    const k = await magazaKur(MARKET, 'yon-kapali');
    const kat = await prisma.category.create({ data: { storeId: k.storeId, name: 'V02 yon kat', slug: `v02-${KOSU}-yon-kat` } });
    const bos = await prisma.category.create({ data: { storeId: k.storeId, name: 'V02 bos kat', slug: `v02-${KOSU}-bos-kat` } });
    const yayinda = await urunKur(k.storeId, 'yon-yayinda', { categoryId: kat.id, stock: 0 });
    const bekleyen = await urunKur(k.storeId, 'yon-bekleyen', { isActive: false });
    await prisma.store.update({ where: { id: k.storeId }, data: { isActive: false } });

    // Public vitrin kapali kalir.
    await expect(catalog.listProducts(k.storeId, undefined, 0, 50, null)).rejects.toBeInstanceOf(NotFoundException);
    await expect(catalog.listCategories(k.storeId, true, null)).rejects.toBeInstanceOf(NotFoundException);

    // Yonetim: yalniz yayindaki (bekleyen ayri uctan), kategori suzgeci calisir.
    expect((await catalog.yonetimUrunleri(k.storeId, k.sahip, MERCHANT, MARKET)).map((p) => p.id)).toEqual([yayinda]);
    expect((await catalog.yonetimUrunleri(k.storeId, k.sahip, MERCHANT, MARKET, bos.id)).map((p) => p.id)).toEqual([]);
    expect((await catalog.listPending(k.storeId, k.sahip, MERCHANT, MARKET)).map((p) => p.id)).toEqual([bekleyen]);
    const agac = await catalog.yonetimKategorileri(k.storeId, k.sahip, MERCHANT, MARKET);
    expect(agac.map((c: any) => c.id).sort()).toEqual([kat.id, bos.id].sort());
  });

  it('V11: urunsuz magaza ve ACTIVE olmayan satici yonetim verisini okur; public 404', async () => {
    const u = await magazaKur(MARKET, 'yon-urunsuz');
    await expect(catalog.yonetimUrunleri(u.storeId, u.sahip, MERCHANT, MARKET)).resolves.toEqual([]);
    await expect(catalog.yonetimKategorileri(u.storeId, u.sahip, MERCHANT, MARKET)).resolves.toEqual([]);

    const a = await magazaKur(MARKET, 'yon-aski');
    const urun = await urunKur(a.storeId, 'yon-aski');
    await prisma.seller.update({ where: { id: a.sellerId }, data: { status: SellerStatus.SUSPENDED } });
    await expect(catalog.listProducts(a.storeId, undefined, 0, 50, null)).rejects.toBeInstanceOf(NotFoundException);
    expect((await catalog.yonetimUrunleri(a.storeId, a.sahip, MERCHANT, MARKET)).map((p) => p.id)).toEqual([urun]);
  });

  it('V12: yetki - personel (STORE_STOCK gecer, STORE_KITCHEN 403), baska satici 403, dikey 400/403, admin gecer', async () => {
    const p = await magazaKur(MARKET, 'yon-yetki');
    const stok = await kullaniciKur('yon-stok', [Role.CUSTOMER]);
    const mutfak = await kullaniciKur('yon-mutfak', [Role.CUSTOMER]);
    await prisma.userRole.createMany({
      data: [
        { userId: stok, storeId: p.storeId, role: Role.STORE_STOCK },
        { userId: mutfak, storeId: p.storeId, role: Role.STORE_KITCHEN },
      ],
    });

    for (const cagri of [
      (u: string, r: Role[], d: BusinessUnit | null) => catalog.yonetimUrunleri(p.storeId, u, r, d),
      (u: string, r: Role[], d: BusinessUnit | null) => catalog.yonetimKategorileri(p.storeId, u, r, d),
    ]) {
      await expect(cagri(stok, [Role.CUSTOMER], MARKET)).resolves.toBeDefined();
      await expect(cagri(mutfak, [Role.CUSTOMER], MARKET)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(cagri(M.sahip, MERCHANT, MARKET)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(cagri(p.sahip, MERCHANT, null)).rejects.toBeInstanceOf(BadRequestException);
      await expect(cagri(p.sahip, MERCHANT, YEMEK)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(cagri(admin, [Role.ADMIN], null)).resolves.toBeDefined();
    }
  });
});
