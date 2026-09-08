// TESLIMAT BOLGESI — GERCEK PostgreSQL ESZAMANLILIK TESTLERI (D136 / C3A-005).
//
// BU DOSYA MOCK KULLANMAZ. Birim paketi (delivery-zone.adapter.spec.ts) SOZLESME
// davranisini kanitlar; burasi DB'nin gercek kilit/CAS/rollback davranisini olcer.
// Ikisi birbirinin YERINE GECMEZ.
//
// CALISTIRMA: `pnpm run test:int` + INTEGRATION_DATABASE_URL (bani_test).
//   · normal `pnpm test` bu dosyayi TOPLAMAZ (jest.config.js testPathIgnorePatterns)
//   · production imaj build'i (Dockerfile, D130) veritabani BAGIMSIZ kalir
//
// MIGRATION SORUMLULUGU BURADA DEGIL: bu dosya `prisma migrate deploy`
// CALISTIRMAZ; hazir ve migrate edilmis bir bani_test varsayar. Orkestrasyon
// CI workflow'unun isidir (.github/workflows/ci.yml, integration job).
//
// FAIL-CLOSED: INTEGRATION_DATABASE_URL yoksa ya da hedef veritabani 'bani_test'
// degilse HICBIR baglanti kurulmaz, HICBIR yikici islem yapilmaz. Development
// veya production DATABASE_URL fallback olarak KULLANILMAZ.
//
// ESZAMANLILIK NASIL KURULUYOR: sleep/setTimeout YOK. Iki gercek transaction
// acilir, ikisi de taban duruma bakar, deferred-promise bariyerinde bulusur ve
// ayni anda serbest birakilir. Beklemeyi ve sirayi PostgreSQL'in satir kilidi
// belirler - test degil.
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ChangeRequestAction,
  ChangeRequestStatus,
  Prisma,
  SellerType,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { MarketService, TeslimatBolgeGirdi } from '../../market/market.service';
import { SellerStatusService } from '../../market/seller-status.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SozlesmeService } from '../../sozlesme/sozlesme.service';
import { AdapterRegistry } from './adapter-registry';
import { ApprovalAdapterContext } from './approval-adapter.interface';
import { ApprovalService } from '../approval.service';
import {
  DELIVERY_ZONE_ENTITY_TYPE,
  DeliveryZoneAdapter,
  DeliveryZoneSnapshot,
} from './delivery-zone.adapter';

// ============================================================ GUVENLIK KAPISI

/**
 * TEK KABUL EDILEN HEDEF. Gelistirme veritabani ('bani') ve production ADI BILE
 * buraya yazilmaz; boylece yanlis env ile calistirmak sessizce degil GURULTULU
 * bicimde basarisiz olur.
 */
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

// ================================================================ yardimcilar

type BolgeSatir = {
  il: string;
  ilce: string;
  mahalle: string | null;
  feeKurus: number | null;
};

/** Uretim tarafiyla AYNI siralama (market.service.ts teslimatBolgeleriOkuIc). */
function sirala(satirlar: BolgeSatir[]): BolgeSatir[] {
  return [...satirlar].sort(
    (a, b) =>
      a.il.localeCompare(b.il, 'tr') ||
      a.ilce.localeCompare(b.ilce, 'tr') ||
      (a.mahalle ?? '').localeCompare(b.mahalle ?? '', 'tr'),
  );
}

/** Deferred promise — bariyerin yapi tasi. Zamanlayiciya DEGIL, olaya dayanir. */
function kapi() {
  let ac!: () => void;
  const beklet = new Promise<void>((coz) => {
    ac = coz;
  });
  return { ac, beklet };
}

/**
 * Bariyerli gorev: transaction ACIK haldeyken `bariyer()` cagirilir ve iki gorev
 * de oraya varana kadar hicbiri ilerlemez.
 */
type YarisGorevi<T> = (
  tx: Prisma.TransactionClient,
  bariyer: () => Promise<void>,
) => Promise<T>;

// Kaybeden taraf kazanan commit edene kadar GERCEK bir satir kilidinde bekler;
// bu bir gecikme numarasi degil, olcmek istedigimiz davranis. Yine de CI
// gurultusune karsi genis pay.
const TX_SECENEK = { timeout: 30_000, maxWait: 30_000 };

// =================================================================== fixture

const KOSU = randomUUID().slice(0, 8);
/** Platform kapsami satirlari GLOBAL bir tablodadir; koşuya özel il ile izole edilir. */
const IL = `ZZITEST${KOSU}`;

let prisma: PrismaService;
let market: MarketService;
let adapter: DeliveryZoneAdapter;
let approval: ApprovalService;

let sahipId = '';
let talepEdenId = '';
let inceleyenId = '';
let saticiId = '';

const olusanKullanicilar: string[] = [];
const olusanMagazalar: string[] = [];
let magazaSayaci = 0;

const BAGLAM: ApprovalAdapterContext = {
  actionType: ChangeRequestAction.UPDATE,
  storeId: null,
  businessUnit: null,
};

function bolge(ilce: string, mahalle: string | null, feeKurus: number | null): BolgeSatir {
  return { il: IL, ilce, mahalle, feeKurus };
}

async function kullaniciKur(etiket: string): Promise<string> {
  const kullanici = await prisma.user.create({
    data: { phone: `ITEST-${KOSU}-${etiket}`, name: `ITEST ${etiket}` },
  });
  olusanKullanicilar.push(kullanici.id);
  return kullanici.id;
}

/** Her test KENDI magazasini alir; testler birbirinin durumunu gormez. */
async function magazaKur(baslangic: BolgeSatir[] = []): Promise<string> {
  magazaSayaci += 1;
  const magaza = await prisma.store.create({
    data: {
      ownerId: sahipId,
      sellerId: saticiId,
      name: `ITEST Magaza ${KOSU}-${magazaSayaci}`,
      slug: `itest-${KOSU}-${magazaSayaci}`,
    },
  });
  olusanMagazalar.push(magaza.id);

  // TABAN DURUM DOGRUDAN YAZILIR: seed yazimi CAS'ten gecmez, dolayisiyla
  // revision 0'da kalir. Testlerin cogu "revision 0 + icerik A" tabanindan baslar.
  if (baslangic.length > 0) {
    await prisma.magazaTeslimatBolgesi.createMany({
      data: baslangic.map((b) => ({ storeId: magaza.id, ...b })),
    });
  }
  return magaza.id;
}

/** DB'nin o anki GERCEK hali — uretim koduna sormadan, dogrudan okunur. */
async function durum(storeId: string): Promise<{ revision: number; bolgeler: BolgeSatir[] }> {
  const magaza = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { deliveryZoneRevision: true },
  });
  const satirlar = await prisma.magazaTeslimatBolgesi.findMany({
    where: { storeId },
    select: { il: true, ilce: true, mahalle: true, feeKurus: true },
  });
  return { revision: magaza.deliveryZoneRevision, bolgeler: sirala(satirlar) };
}

/**
 * IKI GERCEK TRANSACTION'I AYNI TABANDAN YARISTIR.
 *
 * Her gorev once transaction'ini fiilen acar, kendi hazirligini yapar, sonra
 * bariyerde bekler. Iki gorev de bariyere vardiginda TEK seferde serbest
 * birakilirlar. Bundan sonrasi PostgreSQL'in isi.
 */
async function ikiliYaris<T1, T2>(
  is1: YarisGorevi<T1>,
  is2: YarisGorevi<T2>,
): Promise<[PromiseSettledResult<T1>, PromiseSettledResult<T2>]> {
  const hazir1 = kapi();
  const hazir2 = kapi();
  const serbest = kapi();

  const bariyerUret = (hazir: { ac: () => void }) => async () => {
    hazir.ac();
    await serbest.beklet;
  };

  const t1 = prisma.$transaction(async (tx) => {
    // BEGIN'in fiilen gonderildigini garanti eder; bariyere ACIK transaction ile gidilir.
    await tx.$queryRaw`SELECT 1`;
    return is1(tx, bariyerUret(hazir1));
  }, TX_SECENEK);

  const t2 = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1`;
    return is2(tx, bariyerUret(hazir2));
  }, TX_SECENEK);

  await Promise.all([hazir1.beklet, hazir2.beklet]);
  serbest.ac();

  const [a, b] = await Promise.allSettled([t1, t2]);
  return [a as PromiseSettledResult<T1>, b as PromiseSettledResult<T2>];
}

function reddedilenSebep(sonuc: PromiseSettledResult<unknown>): unknown {
  return sonuc.status === 'rejected' ? sonuc.reason : undefined;
}

// ==================================================================== kurulum

beforeAll(async () => {
  const url = testVeritabaniUrl();

  prisma = new PrismaService({ datasources: { db: { url } } });
  await prisma.$connect();

  const audit = new AuditService(prisma);
  // teslimat bolgesi yuzeyi bu iki bagimliligi KULLANMAZ; gercek servisleri
  // kurmak ilgisiz bir bagimlilik agacini bu pakete sokardi.
  market = new MarketService(
    prisma,
    audit,
    {} as unknown as SellerStatusService,
    {} as unknown as SozlesmeService,
  );
  adapter = new DeliveryZoneAdapter(prisma, market);
  approval = new ApprovalService(prisma, new AdapterRegistry([adapter]), audit);

  sahipId = await kullaniciKur('sahip');
  talepEdenId = await kullaniciKur('talepeden');
  inceleyenId = await kullaniciKur('inceleyen');

  const satici = await prisma.seller.create({
    data: {
      ownerUserId: sahipId,
      sellerType: SellerType.MARKET,
      legalName: `ITEST Satici ${KOSU}`,
      displayName: `ITEST Satici ${KOSU}`,
    },
  });
  saticiId = satici.id;

  // PLATFORM KAPSAMI: uc ilcenin TAMAMI acik (mahalle = NULL). Boylece hem
  // "ilcenin tamami" hem de serbest mahalle satirlari gecerli olur.
  await prisma.platformHizmetBolgesi.createMany({
    data: [
      { il: IL, ilce: 'MERKEZ', mahalle: null },
      { il: IL, ilce: 'KUZEY', mahalle: null },
      { il: IL, ilce: 'GUNEY', mahalle: null },
    ],
  });
});

afterAll(async () => {
  if (!prisma) return;

  // DEFENSE IN DEPTH: temizlik oncesi hedef bir kez daha dogrulanir. Yalnizca
  // BU kosunun urettigi satirlar silinir; global truncate YOK.
  testVeritabaniUrl();

  if (olusanMagazalar.length > 0) {
    await prisma.changeRequest.deleteMany({ where: { storeId: { in: olusanMagazalar } } });
    // magaza silinince magaza_teslimat_bolgeleri ve store_users CASCADE ile gider.
    await prisma.store.deleteMany({ where: { id: { in: olusanMagazalar } } });
  }
  if (saticiId) await prisma.seller.deleteMany({ where: { id: saticiId } });
  if (olusanKullanicilar.length > 0) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: olusanKullanicilar } } });
    await prisma.user.deleteMany({ where: { id: { in: olusanKullanicilar } } });
  }
  await prisma.platformHizmetBolgesi.deleteMany({ where: { il: IL } });

  await prisma.$disconnect();
});

// ====================================================================== G

describe('G — ayni taban revision ile iki eszamanli yazici', () => {
  it('tam olarak biri kazanir, digeri Conflict alir; sessiz uzerine yazma YOK', async () => {
    const storeId = await magazaKur([bolge('MERKEZ', null, 100)]);

    const listeX: TeslimatBolgeGirdi[] = [bolge('KUZEY', null, 200)];
    const listeY: TeslimatBolgeGirdi[] = [bolge('GUNEY', null, 300)];

    const [r1, r2] = await ikiliYaris(
      async (tx, bariyer) => {
        await bariyer();
        return market.teslimatBolgeleriYazTx(tx, storeId, listeX, 0);
      },
      async (tx, bariyer) => {
        await bariyer();
        return market.teslimatBolgeleriYazTx(tx, storeId, listeY, 0);
      },
    );

    const basarili = [r1, r2].filter((r) => r.status === 'fulfilled');
    const basarisiz = [r1, r2].filter((r) => r.status === 'rejected');
    expect(basarili).toHaveLength(1);
    expect(basarisiz).toHaveLength(1);
    expect(reddedilenSebep(basarisiz[0])).toBeInstanceOf(ConflictException);

    const son = await durum(storeId);
    expect(son.revision).toBe(1);

    // SESSIZ UZERINE YAZMA KONTROLU: sonuc KAZANANIN listesidir; iki listenin
    // karisimi ya da kaybedenin listesi DEGIL.
    const beklenen = r1.status === 'fulfilled' ? listeX : listeY;
    expect(son.bolgeler).toEqual(sirala(beklenen as BolgeSatir[]));
  });

  it('bos liste yolu da CAS ile korunur (createMany atlansa bile)', async () => {
    const storeId = await magazaKur([bolge('MERKEZ', null, 100)]);
    const dolu: TeslimatBolgeGirdi[] = [bolge('KUZEY', null, 250)];

    const [r1, r2] = await ikiliYaris(
      async (tx, bariyer) => {
        await bariyer();
        // BOS LISTE: createMany HIC cagrilmaz. Ortuk FK kilidine guvenen bir
        // tasarim burada korumasiz kalirdi; koruma CAS'ten geliyor.
        return market.teslimatBolgeleriYazTx(tx, storeId, [], 0);
      },
      async (tx, bariyer) => {
        await bariyer();
        return market.teslimatBolgeleriYazTx(tx, storeId, dolu, 0);
      },
    );

    expect([r1, r2].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const basarisiz = [r1, r2].filter((r) => r.status === 'rejected');
    expect(reddedilenSebep(basarisiz[0])).toBeInstanceOf(ConflictException);

    const son = await durum(storeId);
    expect(son.revision).toBe(1);
    expect(son.bolgeler).toEqual(
      r1.status === 'fulfilled' ? [] : sirala(dolu as BolgeSatir[]),
    );
  });
});

// ====================================================================== H

describe('H — approval apply yolu ile normal panel yazicisi ayni tabanda yarisir', () => {
  it('biri kazanir, digeri Conflict; revision yalnizca 1 artar', async () => {
    const storeId = await magazaKur([bolge('MERKEZ', null, 100)]);

    const approvalListesi: BolgeSatir[] = [bolge('KUZEY', null, 400)];
    const panelListesi: BolgeSatir[] = [bolge('GUNEY', null, 500)];

    const [rApproval, rPanel] = await ikiliYaris(
      // APPROVAL TARAFI: gercek adapter.apply — beklenen revision persist edilmis
      // proposedData zarfindan gelir.
      async (tx, bariyer) => {
        await bariyer();
        return adapter.apply(tx, {
          entityId: storeId,
          actionType: ChangeRequestAction.UPDATE,
          proposedData: { beklenenRevision: 0, bolgeler: approvalListesi },
          context: { ...BAGLAM, storeId },
        });
      },
      // PANEL TARAFI: teslimatBolgeleriGuncelle'nin transaction govdesiyle AYNI
      // sira - once revision okunur, sonra primitive cagrilir. Okuma BARIYERDEN
      // ONCE yapilir; boylece iki taraf da taban revision 0'i GARANTILI gorur.
      async (tx, bariyer) => {
        const magaza = await tx.store.findUniqueOrThrow({
          where: { id: storeId },
          select: { deliveryZoneRevision: true },
        });
        expect(magaza.deliveryZoneRevision).toBe(0);
        await bariyer();
        return market.teslimatBolgeleriYazTx(
          tx,
          storeId,
          panelListesi,
          magaza.deliveryZoneRevision,
        );
      },
    );

    const sonuclar = [rApproval, rPanel];
    expect(sonuclar.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const basarisiz = sonuclar.filter((r) => r.status === 'rejected');
    expect(reddedilenSebep(basarisiz[0])).toBeInstanceOf(ConflictException);

    const son = await durum(storeId);
    expect(son.revision).toBe(1);
    expect(son.bolgeler).toEqual(
      sirala(rApproval.status === 'fulfilled' ? approvalListesi : panelListesi),
    );
  });
});

// ====================================================================== I

describe('I — CAS kazanani geri sarilirsa', () => {
  it('rollback revision ve icerigi tabana geri getirir', async () => {
    const taban = [bolge('MERKEZ', null, 100)];
    const storeId = await magazaKur(taban);

    await expect(
      prisma.$transaction(async (tx) => {
        await market.teslimatBolgeleriYazTx(tx, storeId, [bolge('KUZEY', null, 700)], 0);
        // CAS KAZANILDI, transaction HENUZ commit EDILMEDI.
        throw new Error('ITEST_KASITLI_HATA');
      }, TX_SECENEK),
    ).rejects.toThrow('ITEST_KASITLI_HATA');

    const son = await durum(storeId);
    expect(son.revision).toBe(0);
    expect(son.bolgeler).toEqual(sirala(taban));
  });

  it('kaybeden degil, KAZANAN geri sarilinca bir sonraki talip ayni tabanla basarili olur', async () => {
    const storeId = await magazaKur([bolge('MERKEZ', null, 100)]);
    const ikinciListe: BolgeSatir[] = [bolge('GUNEY', null, 800)];

    const casTamam = kapi();
    const cikabilir = kapi();

    const t1 = prisma.$transaction(async (tx) => {
      await market.teslimatBolgeleriYazTx(tx, storeId, [bolge('KUZEY', null, 700)], 0);
      // Bu noktada stores satirinin yazma kilidi T1'de ve revision (henuz
      // commit edilmemis olarak) 1.
      casTamam.ac();
      await cikabilir.beklet;
      throw new Error('ITEST_KAZANAN_GERI_SARIYOR');
    }, TX_SECENEK);

    await casTamam.beklet;

    // T2 AYNI TABANLA (0) girer. T1 kilidi biraktiginda WHERE yeniden
    // degerlendirilir; T1 geri sarildigi icin revision hala 0'dir -> T2 KAZANIR.
    const t2 = prisma.$transaction(
      async (tx) => market.teslimatBolgeleriYazTx(tx, storeId, ikinciListe, 0),
      TX_SECENEK,
    );

    cikabilir.ac();

    await expect(t1).rejects.toThrow('ITEST_KAZANAN_GERI_SARIYOR');
    // ISKELET SIRADAN BAGIMSIZ: T2 ister kilitte beklemis ister T1 geri
    // sarildiktan sonra baslamis olsun, BEKLENEN SONUC ayni. Bu yuzden testte
    // sleep/timing yok.
    await expect(t2).resolves.toBeDefined();

    const son = await durum(storeId);
    expect(son.revision).toBe(1);
    expect(son.bolgeler).toEqual(sirala(ikinciListe));
  });
});

// ====================================================================== J

describe('J — A -> B -> A donusu (icerik ayni, revision farkli)', () => {
  it('Core bayat talebi revision uzerinden yakalar; apply HIC calismaz', async () => {
    const listeA: BolgeSatir[] = [bolge('MERKEZ', null, 100)];
    const listeB: BolgeSatir[] = [bolge('KUZEY', null, 900)];
    const storeId = await magazaKur(listeA);

    const talep = await approval.submit({
      entityType: DELIVERY_ZONE_ENTITY_TYPE,
      entityId: storeId,
      actionType: ChangeRequestAction.UPDATE,
      storeId,
      proposedData: { bolgeler: [bolge('GUNEY', null, 111)] },
      requestedById: talepEdenId,
    });

    const taban = talep.beforeData as unknown as DeliveryZoneSnapshot;
    expect(taban.revision).toBe(0);

    // Writer 1: A -> B  (revision 0 -> 1)
    await prisma.$transaction(
      async (tx) => market.teslimatBolgeleriYazTx(tx, storeId, listeB, 0),
      TX_SECENEK,
    );
    // Writer 2: B -> A  (revision 1 -> 2) — ICERIK TABANA GERI DONDU
    await prisma.$transaction(
      async (tx) => market.teslimatBolgeleriYazTx(tx, storeId, listeA, 1),
      TX_SECENEK,
    );

    const araDurum = await durum(storeId);
    expect(araDurum.revision).toBe(2);

    // TESTIN CEKIRDEGI: icerik taban ile BIREBIR AYNI. Yalnizca liste
    // karsilastiran bir tasarim burada "degismemis" der ve bayat talebi UYGULAR.
    expect(araDurum.bolgeler).toEqual(sirala(taban.bolgeler as BolgeSatir[]));

    await expect(
      approval.approve({ changeRequestId: talep.id, reviewerId: inceleyenId }),
    ).rejects.toBeInstanceOf(ConflictException);

    // APPLY HIC CALISMADI: icerik ve revision degismedi.
    const son = await durum(storeId);
    expect(son.revision).toBe(2);
    expect(son.bolgeler).toEqual(sirala(listeA));

    // CORE TRANSACTION KAPSAMI: sahiplenme de onay izi de geri sarildi.
    const kayit = await prisma.changeRequest.findUniqueOrThrow({ where: { id: talep.id } });
    expect(kayit.status).toBe(ChangeRequestStatus.PENDING);
    expect(kayit.reviewedById).toBeNull();
    expect(
      await prisma.auditLog.count({
        where: { action: 'approval.approve', entityId: talep.id },
      }),
    ).toBe(0);
  });
});

// ====================================================================== K / L

describe('K — ayni satir sayisi, farkli icerik', () => {
  it('satir sayisi degismese bile yaris korunur (delete-count CAS yetmezdi)', async () => {
    const taban = [
      bolge('MERKEZ', 'MAH1', 10),
      bolge('MERKEZ', 'MAH2', 20),
      bolge('MERKEZ', 'MAH3', 30),
    ];
    const storeId = await magazaKur(taban);

    const listeX: BolgeSatir[] = [
      bolge('MERKEZ', 'MAH4', 40),
      bolge('MERKEZ', 'MAH5', 50),
      bolge('MERKEZ', 'MAH6', 60),
    ];
    const listeY: BolgeSatir[] = [
      bolge('MERKEZ', 'MAH7', 70),
      bolge('MERKEZ', 'MAH8', 80),
      bolge('MERKEZ', 'MAH9', 90),
    ];

    const [r1, r2] = await ikiliYaris(
      async (tx, bariyer) => {
        await bariyer();
        return market.teslimatBolgeleriYazTx(tx, storeId, listeX, 0);
      },
      async (tx, bariyer) => {
        await bariyer();
        return market.teslimatBolgeleriYazTx(tx, storeId, listeY, 0);
      },
    );

    expect([r1, r2].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(reddedilenSebep([r1, r2].filter((r) => r.status === 'rejected')[0])).toBeInstanceOf(
      ConflictException,
    );

    const son = await durum(storeId);
    expect(son.revision).toBe(1);
    expect(son.bolgeler).toHaveLength(3); // sayim DEGISMEDI
    expect(son.bolgeler).toEqual(sirala(r1.status === 'fulfilled' ? listeX : listeY));
  });
});

describe('L — ayni anahtarlar, yalnizca ucret degisir', () => {
  it('yalnizca feeKurus degisen yarista da sessiz uzerine yazma YOK', async () => {
    const storeId = await magazaKur([bolge('MERKEZ', 'MAH1', 100)]);

    const listeX: BolgeSatir[] = [bolge('MERKEZ', 'MAH1', 200)];
    const listeY: BolgeSatir[] = [bolge('MERKEZ', 'MAH1', 300)];

    const [r1, r2] = await ikiliYaris(
      async (tx, bariyer) => {
        await bariyer();
        return market.teslimatBolgeleriYazTx(tx, storeId, listeX, 0);
      },
      async (tx, bariyer) => {
        await bariyer();
        return market.teslimatBolgeleriYazTx(tx, storeId, listeY, 0);
      },
    );

    expect([r1, r2].filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(reddedilenSebep([r1, r2].filter((r) => r.status === 'rejected')[0])).toBeInstanceOf(
      ConflictException,
    );

    const son = await durum(storeId);
    expect(son.revision).toBe(1);
    expect(son.bolgeler).toEqual(sirala(r1.status === 'fulfilled' ? listeX : listeY));
    // Kaybedenin ucreti HIC yazilmadi.
    expect(son.bolgeler[0].feeKurus).toBe(r1.status === 'fulfilled' ? 200 : 300);
  });
});

// ====================================================================== M

describe('M — revision tam olarak +1', () => {
  it('ardisik basarili yazimlar 0 -> 1 -> 2 -> 3 ilerler (cift artis YOK)', async () => {
    const storeId = await magazaKur();

    for (let beklenen = 0; beklenen < 3; beklenen += 1) {
      const sonuc = await prisma.$transaction(
        async (tx) =>
          market.teslimatBolgeleriYazTx(
            tx,
            storeId,
            [bolge('MERKEZ', `MAH${beklenen}`, beklenen)],
            beklenen,
          ),
        TX_SECENEK,
      );
      expect(sonuc.revision).toBe(beklenen + 1);
      expect((await durum(storeId)).revision).toBe(beklenen + 1);
    }
  });

  it('basarisiz yazim revision’i HIC degistirmez', async () => {
    const taban = [bolge('MERKEZ', null, 100)];
    const storeId = await magazaKur(taban);

    // Yanlis beklenen revision -> CAS 0 satir gunceller.
    await expect(
      prisma.$transaction(
        async (tx) => market.teslimatBolgeleriYazTx(tx, storeId, [bolge('KUZEY', null, 1)], 5),
        TX_SECENEK,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    const son = await durum(storeId);
    expect(son.revision).toBe(0);
    expect(son.bolgeler).toEqual(sirala(taban));
  });
});

// ====================================================================== N

describe('N — CAS basarili, sonrasinda GERCEK bir cocuk-tablo yazma hatasi', () => {
  it('hem bolgeler hem revision geri sarilir', async () => {
    const taban = [bolge('MERKEZ', 'MAH1', 100)];
    const storeId = await magazaKur(taban);

    await expect(
      prisma.$transaction(async (tx) => {
        await market.teslimatBolgeleriYazTx(tx, storeId, [bolge('KUZEY', 'MAH2', 200)], 0);

        // GERCEK DB HATASI (JS throw DEGIL): ayni satiri tekrar yazmak
        // magaza_teslimat_bolgeleri uzerindeki @@unique([storeId, il, ilce, mahalle])
        // kisitini ihlal eder. mahalle BILEREK NULL DEGIL - Postgres'te NULL != NULL
        // oldugu icin NULL'lu satirda bu index tetiklenmezdi.
        await tx.magazaTeslimatBolgesi.create({
          data: { storeId, il: IL, ilce: 'KUZEY', mahalle: 'MAH2', feeKurus: 999 },
        });
      }, TX_SECENEK),
    ).rejects.toBeDefined();

    const son = await durum(storeId);
    expect(son.revision).toBe(0);
    expect(son.bolgeler).toEqual(sirala(taban));
  });
});
