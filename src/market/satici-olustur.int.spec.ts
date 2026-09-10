// SATICI BASVURUSU ACMA — GERCEK PostgreSQL ESZAMANLILIK TESTI (S2 / T5).
//
// BU DOSYA MOCK KULLANMAZ. Birim paketi (satici-olustur.spec.ts) SOZLESME
// davranisini kanitlar; burasi S1'de acilan kismi unique index'in
// (sellers_active_owner_key) gercek yaris altindaki davranisini olcer.
// Ikisi birbirinin YERINE GECMEZ.
//
// CALISTIRMA: `pnpm run test:int` + INTEGRATION_DATABASE_URL (bani_test).
// MIGRATION SORUMLULUGU BURADA DEGIL: hazir ve migrate edilmis bir bani_test
// varsayilir (orkestrasyon .github/workflows/ci.yml integration job'inda).
//
// FAIL-CLOSED: hedef veritabani 'bani_test' degilse HICBIR baglanti kurulmaz.
// Desen delivery-zone.adapter.int.spec.ts'ten birebir alindi - ikinci bir
// guvenlik kapisi yaklasimi icat edilmedi.
import { randomUUID } from 'node:crypto';
import { BusinessUnit, SellerType } from '@prisma/client';
import { MarketService } from './market.service';
import { CreateSaticiDto } from './dto/seller.dto';
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

let prisma: PrismaService;
let market: MarketService;

const olusanKullanicilar: string[] = [];

async function kullaniciKur(etiket: string): Promise<string> {
  const kullanici = await prisma.user.create({
    data: { phone: `S2ITEST-${KOSU}-${etiket}`, name: `S2ITEST ${etiket}` },
  });
  olusanKullanicilar.push(kullanici.id);
  return kullanici.id;
}

function dto(ustuneYaz: Partial<CreateSaticiDto> = {}): CreateSaticiDto {
  return {
    yetkiliAdSoyad: 'Ayse Yilmaz',
    basvuruEposta: `basvuru-${KOSU}@ornek.com`,
    legalName: `S2ITEST Unvan ${KOSU}`,
    displayName: `S2ITEST Ad ${KOSU}`,
    sellerType: SellerType.MARKET,
    talepEdilenDikey: BusinessUnit.MARKET,
    ...ustuneYaz,
  } as CreateSaticiDto;
}

async function aktifSaticiSayisi(userId: string): Promise<number> {
  return prisma.seller.count({ where: { ownerUserId: userId, deletedAt: null } });
}

// ==================================================================== kurulum

beforeAll(async () => {
  const url = testVeritabaniUrl();
  prisma = new PrismaService({ datasources: { db: { url } } });
  await prisma.$connect();

  // Bu yuzey audit/durum/sozlesme bagimliliklarini KULLANMAZ; gercek servisleri
  // kurmak ilgisiz bir bagimlilik agacini bu pakete sokardi (ayni gerekce:
  // delivery-zone.adapter.int.spec.ts).
  market = new MarketService(
    prisma,
    {} as unknown as AuditService,
    {} as unknown as SellerStatusService,
    {} as unknown as SozlesmeService,
  );
});

afterAll(async () => {
  if (!prisma) return;
  testVeritabaniUrl(); // DEFENSE IN DEPTH: temizlik oncesi hedef bir kez daha dogrulanir

  if (olusanKullanicilar.length > 0) {
    await prisma.seller.deleteMany({ where: { ownerUserId: { in: olusanKullanicilar } } });
    await prisma.user.deleteMany({ where: { id: { in: olusanKullanicilar } } });
  }
  await prisma.$disconnect();
});

// ===================================================================== testler

describe('T5 — es zamanli iki POST', () => {
  it('yalniz 1 aktif Seller kalir ve HICBIR istek ham DB hatasi uretmez', async () => {
    const userId = await kullaniciKur('yaris');

    // sleep/setTimeout YOK: iki cagri ayni anda baslatilir, sirayi ve beklemeyi
    // PostgreSQL'in benzersizlik kisiti belirler - test degil.
    const [a, b] = await Promise.allSettled([
      market.saticiOlustur(userId, dto()),
      market.saticiOlustur(userId, dto({ legalName: 'IKINCI ISTEK UNVANI' })),
    ]);

    // IKISI DE BASARILI: kaybeden istek P2002 alir ama ham hata yukari
    // sizmaz - idempotent olarak kazananin actigi kayit doner.
    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');

    // DB'nin GERCEK hali - uretim koduna sormadan dogrudan okunur.
    expect(await aktifSaticiSayisi(userId)).toBe(1);

    // Iki yanit AYNI kaydi gostermeli.
    const idA = (a as PromiseFulfilledResult<any>).value.id;
    const idB = (b as PromiseFulfilledResult<any>).value.id;
    expect(idA).toBe(idB);
  });

  it('kaybeden istegin govdesi kazananin verisini EZMEZ', async () => {
    const userId = await kullaniciKur('ezme');

    await Promise.allSettled([
      market.saticiOlustur(userId, dto({ legalName: 'BIRINCI' })),
      market.saticiOlustur(userId, dto({ legalName: 'IKINCI' })),
    ]);

    const kayitlar = await prisma.seller.findMany({
      where: { ownerUserId: userId, deletedAt: null },
      select: { legalName: true },
    });
    expect(kayitlar).toHaveLength(1);
    // Hangisinin kazandigi belirsizdir (yaris), ama SONRADAN gelen istek
    // update YAPMADIGI icin deger ikisinden BIRI olmali - karisim degil.
    expect(['BIRINCI', 'IKINCI']).toContain(kayitlar[0].legalName);
  });
});

describe('T4 — ardisik cagri (yaris yok)', () => {
  it('ikinci cagri yeni kayit acmaz, mevcut kaydi doner', async () => {
    const userId = await kullaniciKur('ardisik');

    const birinci = await market.saticiOlustur(userId, dto({ legalName: 'ILK UNVAN' }));
    const ikinci = await market.saticiOlustur(userId, dto({ legalName: 'DEGISTIRILMEK ISTENEN' }));

    expect(await aktifSaticiSayisi(userId)).toBe(1);
    expect(ikinci.id).toBe(birinci.id);
    // MEVCUT ALANLAR EZILMEZ: POST sessizce PATCH'e donusmemeli.
    expect(ikinci.legalName).toBe('ILK UNVAN');
  });
});

describe('S1 kismi unique index — kapsam dogrulamasi', () => {
  it('soft-delete edilmis satici YENI basvuruyu ENGELLEMEZ', async () => {
    const userId = await kullaniciKur('softdelete');

    const birinci = await market.saticiOlustur(userId, dto({ legalName: 'ESKI' }));
    await prisma.seller.update({ where: { id: birinci.id }, data: { deletedAt: new Date() } });

    const ikinci = await market.saticiOlustur(userId, dto({ legalName: 'YENI' }));

    expect(ikinci.id).not.toBe(birinci.id);
    expect(ikinci.legalName).toBe('YENI');
    expect(await aktifSaticiSayisi(userId)).toBe(1);
  });

  it('FARKLI kullanicilar birbirini engellemez', async () => {
    const kullaniciA = await kullaniciKur('capraz-a');
    const kullaniciB = await kullaniciKur('capraz-b');

    const a = await market.saticiOlustur(kullaniciA, dto());
    const b = await market.saticiOlustur(kullaniciB, dto());

    expect(a.id).not.toBe(b.id);
    expect(await aktifSaticiSayisi(kullaniciA)).toBe(1);
    expect(await aktifSaticiSayisi(kullaniciB)).toBe(1);
  });
});

describe('T2/T3 — yan etki YOK (gercek DB)', () => {
  it('magaza yaratilmaz ve kullaniciya rol verilmez', async () => {
    const userId = await kullaniciKur('yanetki');

    await market.saticiOlustur(userId, dto());

    expect(await prisma.store.count({ where: { ownerId: userId } })).toBe(0);
    expect(await prisma.userRole.count({ where: { userId } })).toBe(0);
  });
});

describe('T11 — vergi kimligi gercek DB', () => {
  it('kolonda ciphertext durur, yanit duz metni TASIMAZ', async () => {
    const userId = await kullaniciKur('vergi');

    const sonuc = await market.saticiOlustur(userId, dto({ taxIdentifier: '1234567890' }));

    const ham = await prisma.seller.findUniqueOrThrow({
      where: { id: sonuc.id },
      select: { taxIdentifier: true, taxLast4: true },
    });
    expect(ham.taxIdentifier).not.toBe('1234567890');
    expect(ham.taxIdentifier).toMatch(/^v1:/);
    expect(ham.taxLast4).toBe('7890');

    expect(sonuc).not.toHaveProperty('taxIdentifier');
    expect(JSON.stringify(sonuc)).not.toContain('1234567890');
  });
});
