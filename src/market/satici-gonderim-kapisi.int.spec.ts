// 02 — BASVURU GONDERIM KAPISI — ENTEGRASYON TESTLERI. GERCEK PostgreSQL GEREKTIRIR.
//
// NE KANITLIYOR (birim testlerin SAHTE mock'la kanitlayamayacaklari):
//   · AKTIF SURUM ESASI: eski bir surume verilmis onay, yeni aktif surumun
//     yerine GECMEZ - gercek sozlesme_versiyonlari/sozlesme_onaylari satirlari
//     ve SozlesmeService'in kendi sorgusuyla;
//   · aktif surum YOKSA 503 ve DB DEGISMEZ;
//   · REDDEDILDI belge gercek satirda da sarti karsilamaz;
//   · GERCEK YARIS: ayni saticiya es zamanli iki gonderimde yalnizca biri
//     UNDER_REVIEW yazar, digeri 409 alir (kosullu yazim/CAS bozulmadi).
//
// CALISTIRMA: `pnpm run test:int` + INTEGRATION_DATABASE_URL (bani_test).
// FAIL-CLOSED: hedef veritabani 'bani_test' degilse HICBIR baglanti kurulmaz.
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  Role,
  SaticiBelgeDurum,
  SaticiBelgeTipi,
  SellerStatus,
  SellerType,
  SellerVerification,
  SozlesmeTipi,
} from '@prisma/client';
import { MarketService } from './market.service';
import { SellerStatusService } from './seller-status.service';
import { AuditService } from '../common/audit/audit.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
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
const SURUM_ONEKI = `02-int-${KOSU}`;

let prisma: PrismaService;
let market: MarketService;

const olusanKullanicilar: string[] = [];
let kullaniciSayaci = 0;

async function kullaniciKur(etiket: string): Promise<string> {
  kullaniciSayaci += 1;
  const k = await prisma.user.create({
    data: { phone: `S02-${KOSU}-${kullaniciSayaci}-${etiket}`, name: 'S02', surname: etiket },
  });
  olusanKullanicilar.push(k.id);
  await prisma.userRole.create({ data: { userId: k.id, role: Role.CUSTOMER, storeId: null } });
  return k.id;
}

/** Her senaryoya KENDI saticisi. Varsayilan: gonderilebilir bir DRAFT basvuru. */
async function saticiKur(ek: Record<string, unknown> = {}) {
  const sahip = await kullaniciKur('sahip');
  const s = await prisma.seller.create({
    data: {
      ownerUserId: sahip,
      sellerType: SellerType.MARKET,
      legalName: `S02 Unvan ${KOSU}`,
      displayName: `S02 Ad ${KOSU}`,
      yetkiliAdSoyad: 'Ayse Yilmaz',
      basvuruEposta: `s02-${KOSU}@ornek.com`,
      taxIdentifier: `v1:iv:tag:S02-GIZLI-${KOSU}`,
      taxLast4: '9999',
      status: SellerStatus.DRAFT,
      verification: SellerVerification.EKSIK,
      ...ek,
    },
  });
  return { sellerId: s.id, sahip };
}

async function levhaEkle(sellerId: string, durum: SaticiBelgeDurum = SaticiBelgeDurum.BEKLIYOR) {
  await prisma.saticiBelge.create({
    data: {
      sellerId,
      tip: SaticiBelgeTipi.VERGI_LEVHASI,
      dosyaUrl: `https://res.cloudinary.com/demo/image/authenticated/v1/test/${KOSU}.pdf`,
      durum,
    },
  });
}

/** Tipe YENI ve tek aktif surum yayinlar; oncekileri pasife ceker. */
async function surumYayinla(tip: SozlesmeTipi, etiket: string, ileriSaniye: number) {
  await prisma.sozlesmeVersiyon.updateMany({ where: { tip, aktif: true }, data: { aktif: false } });
  return prisma.sozlesmeVersiyon.create({
    data: {
      tip,
      surum: `${SURUM_ONEKI}-${etiket}`,
      metinHash: `hash-${SURUM_ONEKI}-${etiket}`,
      yururlukTarihi: new Date(Date.now() + ileriSaniye * 1000),
      aktif: true,
    },
  });
}

async function onayla(kullaniciId: string, tip: SozlesmeTipi, surum: string) {
  await prisma.sozlesmeOnay.create({
    data: { kullaniciId, sozlesmeTipi: tip, surum, metinHash: `hash-${surum}` },
  });
}

const durumOku = (id: string) =>
  prisma.seller.findUniqueOrThrow({ where: { id }, select: { status: true, redGerekce: true } });

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
    const saticilar = await prisma.seller.findMany({
      where: { ownerUserId: { in: olusanKullanicilar } }, select: { id: true },
    });
    const saticiIdleri = saticilar.map((s) => s.id);
    await prisma.saticiBelge.deleteMany({ where: { sellerId: { in: saticiIdleri } } });
    await prisma.sozlesmeOnay.deleteMany({ where: { kullaniciId: { in: olusanKullanicilar } } });
    await prisma.seller.deleteMany({ where: { id: { in: saticiIdleri } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: olusanKullanicilar } } });
    await prisma.user.deleteMany({ where: { id: { in: olusanKullanicilar } } });
  }
  // BU KOSUNUN yayinladigi surumler: yalnizca kendi onekimizi sileriz.
  await prisma.sozlesmeVersiyon.deleteMany({ where: { surum: { startsWith: SURUM_ONEKI } } });
  await prisma.$disconnect();
});

// ===================================================================== testler

describe('02 int — aktif sozlesme surumu YOKKEN', () => {
  // Bu blok, tipin aktif surumunu GECICI olarak kaldirir ve sonunda geri verir;
  // boylece dosya icindeki sira bagimliligi olusmaz.
  const pasiflestirilenler: string[] = [];

  beforeAll(async () => {
    const aktifler = await prisma.sozlesmeVersiyon.findMany({
      where: { tip: { in: [SozlesmeTipi.SATICI, SozlesmeTipi.SATICI_KOMISYON] }, aktif: true },
      select: { id: true },
    });
    pasiflestirilenler.push(...aktifler.map((v) => v.id));
    await prisma.sozlesmeVersiyon.updateMany({ where: { id: { in: pasiflestirilenler } }, data: { aktif: false } });
  });

  afterAll(async () => {
    if (pasiflestirilenler.length > 0) {
      await prisma.sozlesmeVersiyon.updateMany({ where: { id: { in: pasiflestirilenler } }, data: { aktif: true } });
    }
  });

  it('7a. 503 doner ve basvuru DRAFT kalir', async () => {
    const { sellerId, sahip } = await saticiKur();
    await levhaEkle(sellerId);

    await expect(market.saticiOnayaGonder(sahip)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect((await durumOku(sellerId)).status).toBe(SellerStatus.DRAFT);
  });
});

describe('02 int — gercek sozlesme surumleriyle', () => {
  let saticiSurum = '';
  let komisyonSurum = '';

  beforeAll(async () => {
    saticiSurum = (await surumYayinla(SozlesmeTipi.SATICI, 'satici-v1', 60)).surum;
    komisyonSurum = (await surumYayinla(SozlesmeTipi.SATICI_KOMISYON, 'komisyon-v1', 60)).surum;
  });

  it('8. butun sartlar tamam -> UNDER_REVIEW', async () => {
    const { sellerId, sahip } = await saticiKur({
      status: SellerStatus.NEEDS_FIX,
      redGerekce: 'Eksik belge',
    });
    await levhaEkle(sellerId);
    await onayla(sahip, SozlesmeTipi.SATICI, saticiSurum);
    await onayla(sahip, SozlesmeTipi.SATICI_KOMISYON, komisyonSurum);

    await market.saticiOnayaGonder(sahip);

    const satir = await durumOku(sellerId);
    expect(satir.status).toBe(SellerStatus.UNDER_REVIEW);
    // Yeniden gonderimde eski NEEDS_FIX gerekcesi temizlenir (S4.2 korunuyor).
    expect(satir.redGerekce).toBeNull();
  });

  it('4. yalnizca REDDEDILDI levha -> 409 ve DRAFT kalir', async () => {
    const { sellerId, sahip } = await saticiKur();
    await levhaEkle(sellerId, SaticiBelgeDurum.REDDEDILDI);
    await onayla(sahip, SozlesmeTipi.SATICI, saticiSurum);
    await onayla(sahip, SozlesmeTipi.SATICI_KOMISYON, komisyonSurum);

    await expect(market.saticiOnayaGonder(sahip)).rejects.toBeInstanceOf(ConflictException);
    expect((await durumOku(sellerId)).status).toBe(SellerStatus.DRAFT);
  });

  it('5/6. sozlesme onaylari eksikse 409 ve DRAFT kalir', async () => {
    const { sellerId, sahip } = await saticiKur();
    await levhaEkle(sellerId);
    await onayla(sahip, SozlesmeTipi.SATICI, saticiSurum); // komisyon BILEREK yok

    await expect(market.saticiOnayaGonder(sahip)).rejects.toBeInstanceOf(ConflictException);
    expect((await durumOku(sellerId)).status).toBe(SellerStatus.DRAFT);
  });

  it('7b. ESKI surume verilmis onay, YENI aktif surumun yerine gecmez', async () => {
    const { sellerId, sahip } = await saticiKur();
    await levhaEkle(sellerId);
    await onayla(sahip, SozlesmeTipi.SATICI, saticiSurum);
    await onayla(sahip, SozlesmeTipi.SATICI_KOMISYON, komisyonSurum);

    // Komisyon sartlari degisti: yeni surum yayinlandi, eski onay artik gecmez.
    const yeni = await surumYayinla(SozlesmeTipi.SATICI_KOMISYON, 'komisyon-v2', 120);
    try {
      await expect(market.saticiOnayaGonder(sahip)).rejects.toBeInstanceOf(ConflictException);
      expect((await durumOku(sellerId)).status).toBe(SellerStatus.DRAFT);

      // Yeni surumu onaylayinca gecis acilir.
      await onayla(sahip, SozlesmeTipi.SATICI_KOMISYON, yeni.surum);
      await market.saticiOnayaGonder(sahip);
      expect((await durumOku(sellerId)).status).toBe(SellerStatus.UNDER_REVIEW);
    } finally {
      // Sonraki testler v1 aktifken calissin.
      await prisma.sozlesmeVersiyon.update({ where: { id: yeni.id }, data: { aktif: false } });
      await prisma.sozlesmeVersiyon.updateMany({
        where: { tip: SozlesmeTipi.SATICI_KOMISYON, surum: komisyonSurum },
        data: { aktif: true },
      });
    }
  });

  it('9. es zamanli iki gonderimden yalnizca BIRI gecer', async () => {
    const { sellerId, sahip } = await saticiKur();
    await levhaEkle(sellerId);
    await onayla(sahip, SozlesmeTipi.SATICI, saticiSurum);
    await onayla(sahip, SozlesmeTipi.SATICI_KOMISYON, komisyonSurum);

    const sonuclar = await Promise.allSettled([
      market.saticiOnayaGonder(sahip),
      market.saticiOnayaGonder(sahip),
    ]);
    const basarili = sonuclar.filter((s) => s.status === 'fulfilled');
    const basarisiz = sonuclar.filter((s) => s.status === 'rejected');

    expect(basarili).toHaveLength(1);
    expect(basarisiz).toHaveLength(1);
    expect((basarisiz[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect((await durumOku(sellerId)).status).toBe(SellerStatus.UNDER_REVIEW);
  });
});
