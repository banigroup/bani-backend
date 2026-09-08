// TESLIMAT BOLGESI ADAPTER + PAYLASILAN DOMAIN PRIMITIVE — DAVRANIS TESTLERI.
//
// @nestjs/testing KULLANILMAZ: hem MarketService hem DeliveryZoneAdapter
// konumsal constructor bagimliliklariyla dogrudan kurulur.
//
// TEK tx NESNESI: butun sahte Prisma metodlari ayni nesnede yasar; "hepsi ayni
// transaction icinde mi" ve "adapter verilen tx'i mi gecirdi" sorulari cagri
// argumaninin AYNI REFERANS olmasiyla dogrulanir.
//
// MOCK SINIRI: bu dosya SOZLESME davranisini kanitlar. Gercek PostgreSQL
// eszamanlilik ispati AYRI bir entegrasyon paketindedir
// (delivery-zone.concurrency.int-spec.ts) — mock onun yerine GECMEZ.
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ChangeRequestAction, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { MarketService } from '../../market/market.service';
import { SellerStatusService } from '../../market/seller-status.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SozlesmeService } from '../../sozlesme/sozlesme.service';
import { ApprovalAdapterContext } from './approval-adapter.interface';
import {
  DELIVERY_ZONE_ENTITY_TYPE,
  DeliveryZoneAdapter,
  DeliveryZoneProposedData,
  DeliveryZoneSnapshot,
} from './delivery-zone.adapter';

// ---------------------------------------------------------------- sahte altyapi

const MAGAZA = 'store-1';

/** Platform kapsami: Diyarbakir/Kayapinar tum ilce; Diyarbakir/Baglar iki mahalle. */
const KAPSAM = [
  { il: 'Diyarbakır', ilce: 'Kayapınar', mahalle: null },
  { il: 'Diyarbakır', ilce: 'Bağlar', mahalle: 'Şehitlik' },
  { il: 'Diyarbakır', ilce: 'Bağlar', mahalle: 'Muradiye' },
];

function txKur() {
  return {
    store: { findUnique: jest.fn(), updateMany: jest.fn() },
    platformHizmetBolgesi: { findMany: jest.fn() },
    magazaTeslimatBolgesi: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
}

type SahteTx = ReturnType<typeof txKur>;

function kur() {
  const tx = txKur();

  // VARSAYILANLAR — mutlu yol
  tx.platformHizmetBolgesi.findMany.mockResolvedValue(KAPSAM);
  tx.store.findUnique.mockResolvedValue({ deliveryZoneRevision: 7 });
  tx.store.updateMany.mockResolvedValue({ count: 1 });
  tx.magazaTeslimatBolgesi.findMany.mockResolvedValue([]);
  tx.magazaTeslimatBolgesi.deleteMany.mockResolvedValue({ count: 0 });
  tx.magazaTeslimatBolgesi.createMany.mockResolvedValue({ count: 0 });

  // Kok istemci: adapter'in submit-ani dogrulamasi bunu kullanir. AYNI sahte
  // metodlari paylasir ki testte tek yerden kurgulanabilsin; boylece "adapter
  // apply icinde kok istemciye mi gitti" sorusu ayrica cagri argumaniyla
  // (toBe(tx)) kontrol edilir.
  const prisma = {
    store: tx.store,
    platformHizmetBolgesi: tx.platformHizmetBolgesi,
    magazaTeslimatBolgesi: tx.magazaTeslimatBolgesi,
    $transaction: jest.fn(),
  };

  const audit = { record: jest.fn(async () => undefined) };

  const market = new MarketService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    {} as unknown as SellerStatusService,
    {} as unknown as SozlesmeService,
  );

  const adapter = new DeliveryZoneAdapter(prisma as unknown as PrismaService, market);

  return { tx, prisma, market, adapter, audit };
}

const BAGLAM: ApprovalAdapterContext = {
  actionType: ChangeRequestAction.UPDATE,
  storeId: MAGAZA,
  businessUnit: null,
};

function txAs(tx: SahteTx): Prisma.TransactionClient {
  return tx as unknown as Prisma.TransactionClient;
}

// ---------------------------------------------------------------- A/B/D/E/F

describe('DeliveryZoneAdapter.validateProposedData', () => {
  it('A — gecerli proposedData kanonik satirlar + beklenen revision uretir', async () => {
    const { adapter } = kur();

    const sonuc = (await adapter.validateProposedData(
      { bolgeler: [{ il: 'Diyarbakır', ilce: 'Kayapınar', feeKurus: 1500 }] },
      BAGLAM,
    )) as DeliveryZoneProposedData;

    expect(sonuc.beklenenRevision).toBe(7);
    expect(sonuc.bolgeler).toEqual([
      { il: 'Diyarbakır', ilce: 'Kayapınar', mahalle: null, feeKurus: 1500 },
    ]);
  });

  it('B — platform kapsami disi bolge reddedilir', async () => {
    const { adapter } = kur();

    await expect(
      adapter.validateProposedData({ bolgeler: [{ il: 'İstanbul', ilce: 'Kadıköy' }] }, BAGLAM),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('B — bozuk govde reddedilir (bolgeler dizisi yok)', async () => {
    const { adapter } = kur();

    await expect(adapter.validateProposedData({ zones: [] }, BAGLAM)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('D — kanonik esleme: "kayapinar" -> "Kayapınar"', async () => {
    const { adapter } = kur();

    const sonuc = (await adapter.validateProposedData(
      { bolgeler: [{ il: 'diyarbakir', ilce: 'kayapinar' }] },
      BAGLAM,
    )) as DeliveryZoneProposedData;

    expect(sonuc.bolgeler[0]).toEqual({
      il: 'Diyarbakır',
      ilce: 'Kayapınar',
      mahalle: null,
      feeKurus: null,
    });
  });

  it('E — mukerrer satir tekillestirilir (ILK gonderilen kalir)', async () => {
    const { adapter } = kur();

    const sonuc = (await adapter.validateProposedData(
      {
        bolgeler: [
          { il: 'Diyarbakır', ilce: 'Kayapınar', feeKurus: 1000 },
          { il: 'diyarbakir', ilce: 'kayapinar', feeKurus: 9999 },
        ],
      },
      BAGLAM,
    )) as DeliveryZoneProposedData;

    expect(sonuc.bolgeler).toHaveLength(1);
    expect(sonuc.bolgeler[0].feeKurus).toBe(1000);
  });

  it('F — ucret siniri asilirsa reddedilir (DTO devrede olmadigi yoldan da)', async () => {
    const { adapter } = kur();

    await expect(
      adapter.validateProposedData(
        { bolgeler: [{ il: 'Diyarbakır', ilce: 'Kayapınar', feeKurus: 1_000_001 }] },
        BAGLAM,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      adapter.validateProposedData(
        { bolgeler: [{ il: 'Diyarbakır', ilce: 'Kayapınar', feeKurus: -1 }] },
        BAGLAM,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('F — sinir degerleri (0 ve 1.000.000) KABUL edilir', async () => {
    const { adapter } = kur();

    const sonuc = (await adapter.validateProposedData(
      {
        bolgeler: [
          { il: 'Diyarbakır', ilce: 'Bağlar', mahalle: 'Şehitlik', feeKurus: 0 },
          { il: 'Diyarbakır', ilce: 'Bağlar', mahalle: 'Muradiye', feeKurus: 1_000_000 },
        ],
      },
      BAGLAM,
    )) as DeliveryZoneProposedData;

    expect(sonuc.bolgeler.map((b) => b.feeKurus)).toEqual([0, 1_000_000]);
  });

  it('UPDATE disi actionType reddedilir (CREATE yuzeyi acilmaz)', async () => {
    const { adapter } = kur();

    await expect(
      adapter.validateProposedData(
        { bolgeler: [] },
        { ...BAGLAM, actionType: ChangeRequestAction.CREATE },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('storeId yoksa FAIL-CLOSED', async () => {
    const { adapter } = kur();

    await expect(
      adapter.validateProposedData({ bolgeler: [] }, { ...BAGLAM, storeId: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------- G/H/I

describe('DeliveryZoneAdapter snapshot (G/H/I)', () => {
  it('G/H — buildBeforeData ve revalidateCurrentState AYNI sekli, deterministik sirayla uretir', async () => {
    const { tx, adapter } = kur();
    // DB'den KARISIK sirada gelir; snapshot kanonik siralanmali.
    tx.magazaTeslimatBolgesi.findMany.mockResolvedValue([
      { il: 'Diyarbakır', ilce: 'Bağlar', mahalle: 'Şehitlik', feeKurus: 2000 },
      { il: 'Diyarbakır', ilce: 'Kayapınar', mahalle: null, feeKurus: null },
      { il: 'Diyarbakır', ilce: 'Bağlar', mahalle: 'Muradiye', feeKurus: null },
    ]);

    const once = (await adapter.buildBeforeData(txAs(tx), MAGAZA, BAGLAM)) as DeliveryZoneSnapshot;
    const guncel = (await adapter.revalidateCurrentState(
      txAs(tx),
      MAGAZA,
      BAGLAM,
    )) as DeliveryZoneSnapshot;

    expect(once).toEqual(guncel);
    expect(once.bolgeler.map((b) => `${b.ilce}/${b.mahalle ?? '-'}`)).toEqual([
      'Bağlar/Muradiye',
      'Bağlar/Şehitlik',
      'Kayapınar/-',
    ]);
    // JSON-safe: BigInt/Date yok
    expect(JSON.parse(JSON.stringify(once))).toEqual(once);
  });

  it('I — revision snapshot icinde tasinir', async () => {
    const { tx, adapter } = kur();
    tx.store.findUnique.mockResolvedValue({ deliveryZoneRevision: 42 });

    const g = (await adapter.buildBeforeData(txAs(tx), MAGAZA, BAGLAM)) as DeliveryZoneSnapshot;

    expect(g.revision).toBe(42);
  });

  it('magaza yoksa snapshot FAIL-CLOSED', async () => {
    const { tx, adapter } = kur();
    tx.store.findUnique.mockResolvedValue(null);

    await expect(
      adapter.buildBeforeData(txAs(tx), MAGAZA, BAGLAM),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('entityId null ise FAIL-CLOSED', async () => {
    const { tx, adapter } = kur();

    await expect(adapter.buildBeforeData(txAs(tx), null, BAGLAM)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

// ---------------------------------------------------------------- J/K/L/M/O/P/Q

describe('DeliveryZoneAdapter.apply — CAS ve tek kapi', () => {
  const veri: DeliveryZoneProposedData = {
    beklenenRevision: 7,
    bolgeler: [{ il: 'Diyarbakır', ilce: 'Kayapınar', mahalle: null, feeKurus: 1500 }],
  };

  it('J/O/Q — CAS beklenen revision ile yapilir, VERILEN tx kullanilir, liste yazilir', async () => {
    const { tx, adapter } = kur();

    await adapter.apply(txAs(tx), {
      entityId: MAGAZA,
      actionType: ChangeRequestAction.UPDATE,
      proposedData: veri,
      context: BAGLAM,
    });

    // Q — CAS beklenen revision'a karsi
    expect(tx.store.updateMany).toHaveBeenCalledWith({
      where: { id: MAGAZA, deliveryZoneRevision: 7 },
      data: { deliveryZoneRevision: { increment: 1 } },
    });
    // M — whole-list replace
    expect(tx.magazaTeslimatBolgesi.deleteMany).toHaveBeenCalledWith({ where: { storeId: MAGAZA } });
    expect(tx.magazaTeslimatBolgesi.createMany).toHaveBeenCalledWith({
      data: [{ storeId: MAGAZA, il: 'Diyarbakır', ilce: 'Kayapınar', mahalle: null, feeKurus: 1500 }],
    });
    // O — CAS replace'ten ONCE (runtime cagri sirasi)
    expect(tx.store.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.magazaTeslimatBolgesi.deleteMany.mock.invocationCallOrder[0],
    );
  });

  it('K — CAS uyusmazligi (count=0) ConflictException; liste YAZILMAZ', async () => {
    const { tx, adapter } = kur();
    tx.store.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      adapter.apply(txAs(tx), {
        entityId: MAGAZA,
        actionType: ChangeRequestAction.UPDATE,
        proposedData: veri,
        context: BAGLAM,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.magazaTeslimatBolgesi.deleteMany).not.toHaveBeenCalled();
    expect(tx.magazaTeslimatBolgesi.createMany).not.toHaveBeenCalled();
  });

  it('C — D135: onay aninda kapsamdan cikan bolge UYGULANMAZ (fail-closed)', async () => {
    const { tx, adapter } = kur();
    // Submit'te gecerliydi; approve aninda platform kapsami bosaldi (isActive=false).
    tx.platformHizmetBolgesi.findMany.mockResolvedValue([]);

    await expect(
      adapter.apply(txAs(tx), {
        entityId: MAGAZA,
        actionType: ChangeRequestAction.UPDATE,
        proposedData: veri,
        context: BAGLAM,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.store.updateMany).not.toHaveBeenCalled();
    expect(tx.magazaTeslimatBolgesi.deleteMany).not.toHaveBeenCalled();
    expect(tx.magazaTeslimatBolgesi.createMany).not.toHaveBeenCalled();
  });

  it('L — bos liste desteklenir: deleteMany calisir, createMany CALISMAZ', async () => {
    const { tx, adapter } = kur();

    await adapter.apply(txAs(tx), {
      entityId: MAGAZA,
      actionType: ChangeRequestAction.UPDATE,
      proposedData: { beklenenRevision: 7, bolgeler: [] },
      context: BAGLAM,
    });

    expect(tx.store.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.magazaTeslimatBolgesi.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.magazaTeslimatBolgesi.createMany).not.toHaveBeenCalled();
  });

  it('P — adapter kendi Prisma yazma yolunu KURMAZ; yazim paylasilan primitive uzerinden', async () => {
    const { tx, market, adapter } = kur();
    const casus = jest.spyOn(market, 'teslimatBolgeleriYazTx');

    await adapter.apply(txAs(tx), {
      entityId: MAGAZA,
      actionType: ChangeRequestAction.UPDATE,
      proposedData: veri,
      context: BAGLAM,
    });

    expect(casus).toHaveBeenCalledTimes(1);
    // VERILEN tx birebir aktarilir
    expect(casus.mock.calls[0][0]).toBe(tx);
    expect(casus.mock.calls[0][1]).toBe(MAGAZA);
    expect(casus.mock.calls[0][3]).toBe(7);
  });

  it('N — primitive hatasi (createMany patlar) cagirana propagate eder', async () => {
    const { tx, adapter } = kur();
    const hata = new Error('createMany patladi');
    tx.magazaTeslimatBolgesi.createMany.mockRejectedValue(hata);

    await expect(
      adapter.apply(txAs(tx), {
        entityId: MAGAZA,
        actionType: ChangeRequestAction.UPDATE,
        proposedData: veri,
        context: BAGLAM,
      }),
    ).rejects.toBe(hata);
  });

  it('bozuk proposedData zarfi FAIL-CLOSED', async () => {
    const { tx, adapter } = kur();

    await expect(
      adapter.apply(txAs(tx), {
        entityId: MAGAZA,
        actionType: ChangeRequestAction.UPDATE,
        proposedData: { bolgeler: [] }, // beklenenRevision YOK
        context: BAGLAM,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.store.updateMany).not.toHaveBeenCalled();
  });

  it('entityType registry anahtari sabit', () => {
    const { adapter } = kur();
    expect(adapter.entityType).toBe(DELIVERY_ZONE_ENTITY_TYPE);
    expect(adapter.entityType).toBe('DELIVERY_ZONE');
  });
});

// ---------------------------------------------------------------- primitive

describe('MarketService.teslimatBolgeleriYazTx — paylasilan domain primitive', () => {
  it('revision tam olarak +1 ilerler ve sonuc dondurur', async () => {
    const { tx, market } = kur();

    const sonuc = await market.teslimatBolgeleriYazTx(
      txAs(tx),
      MAGAZA,
      [{ il: 'Diyarbakır', ilce: 'Kayapınar' }],
      7,
    );

    expect(sonuc.revision).toBe(8);
    expect(tx.store.updateMany).toHaveBeenCalledWith({
      where: { id: MAGAZA, deliveryZoneRevision: 7 },
      data: { deliveryZoneRevision: { increment: 1 } },
    });
  });

  it('CAS uyusmazliginda ConflictException ve liste degismez', async () => {
    const { tx, market } = kur();
    tx.store.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      market.teslimatBolgeleriYazTx(txAs(tx), MAGAZA, [], 7),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.magazaTeslimatBolgesi.deleteMany).not.toHaveBeenCalled();
  });

  it('dogrulama CAS\'ten ONCE calisir; gecersiz veride revision ilerlemez', async () => {
    const { tx, market } = kur();

    await expect(
      market.teslimatBolgeleriYazTx(txAs(tx), MAGAZA, [{ il: 'İstanbul', ilce: 'Kadıköy' }], 7),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.store.updateMany).not.toHaveBeenCalled();
  });

  it('yalnizca VERILEN tx kullanilir (primitive icinde kok prisma yazmasi yok)', async () => {
    const { tx, prisma, market } = kur();
    prisma.$transaction.mockRejectedValue(new Error('primitive kendi tx acmamali'));

    await market.teslimatBolgeleriYazTx(txAs(tx), MAGAZA, [], 7);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ AUDIT-001
//
// HEDEF MAGAZA KIMLIGI INVARIANT'I. Sozlesme magaza kimligini iki alanda tasiyor
// (ChangeRequest.entityId ve context.storeId) ve esitligi SART KOSMUYOR. Ayrisma
// halinde ApprovalService bagimsizligi talep.storeId'ye gore olcer ama apply
// talep.entityId'ye gider - yani bir magaza sahibi kendi magazasinin talebini
// onaylayabilirdi. Asagidaki testler ayrismanin HICBIR adapter yolundan
// gecemedigini kanitliyor.

/** Ikinci magaza - yalnizca ayrisma senaryosu icin. */
const MAGAZA_B = 'store-2';

describe('AUDIT-001 — entityId / context.storeId invariant', () => {
  const veri: DeliveryZoneProposedData = {
    beklenenRevision: 7,
    bolgeler: [{ il: 'Diyarbakır', ilce: 'Kayapınar', mahalle: null, feeKurus: 100 }],
  };

  /** Fail-closed KANITI: hicbir okuma/yazma baslamadi, yanlis revision okunmadi. */
  function dbyeHicGidilmedi(tx: SahteTx) {
    expect(tx.store.findUnique).not.toHaveBeenCalled();
    expect(tx.store.updateMany).not.toHaveBeenCalled();
    expect(tx.platformHizmetBolgesi.findMany).not.toHaveBeenCalled();
    expect(tx.magazaTeslimatBolgesi.findMany).not.toHaveBeenCalled();
    expect(tx.magazaTeslimatBolgesi.deleteMany).not.toHaveBeenCalled();
    expect(tx.magazaTeslimatBolgesi.createMany).not.toHaveBeenCalled();
  }

  // ---- A) entityId != context.storeId

  it('A — buildBeforeData: ayrisma FAIL-CLOSED, DB\'ye HIC gidilmez', async () => {
    const { tx, adapter } = kur();

    await expect(
      adapter.buildBeforeData(txAs(tx), MAGAZA, { ...BAGLAM, storeId: MAGAZA_B }),
    ).rejects.toBeInstanceOf(BadRequestException);

    dbyeHicGidilmedi(tx);
  });

  it('A — revalidateCurrentState: ayrisma FAIL-CLOSED', async () => {
    const { tx, adapter } = kur();

    await expect(
      adapter.revalidateCurrentState(txAs(tx), MAGAZA, { ...BAGLAM, storeId: MAGAZA_B }),
    ).rejects.toBeInstanceOf(BadRequestException);

    dbyeHicGidilmedi(tx);
  });

  it('A — apply: ayrisma FAIL-CLOSED; paylasilan primitive HIC cagrilmaz', async () => {
    const { tx, market, adapter } = kur();
    const casus = jest.spyOn(market, 'teslimatBolgeleriYazTx');

    await expect(
      adapter.apply(txAs(tx), {
        entityId: MAGAZA,
        actionType: ChangeRequestAction.UPDATE,
        proposedData: veri,
        context: { ...BAGLAM, storeId: MAGAZA_B },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // PRODUCTION MUTASYONU UYGULANMADI
    expect(casus).not.toHaveBeenCalled();
    dbyeHicGidilmedi(tx);
  });

  // ---- B) entityId null

  it('B — apply: entityId null FAIL-CLOSED', async () => {
    const { tx, market, adapter } = kur();
    const casus = jest.spyOn(market, 'teslimatBolgeleriYazTx');

    await expect(
      adapter.apply(txAs(tx), {
        entityId: null,
        actionType: ChangeRequestAction.UPDATE,
        proposedData: veri,
        context: BAGLAM,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(casus).not.toHaveBeenCalled();
    dbyeHicGidilmedi(tx);
  });

  it('B — revalidateCurrentState: entityId null FAIL-CLOSED', async () => {
    const { tx, adapter } = kur();

    await expect(
      adapter.revalidateCurrentState(txAs(tx), null, BAGLAM),
    ).rejects.toBeInstanceOf(BadRequestException);

    dbyeHicGidilmedi(tx);
  });

  // ---- C) context.storeId null

  it('C — buildBeforeData: context.storeId null FAIL-CLOSED', async () => {
    const { tx, adapter } = kur();

    await expect(
      adapter.buildBeforeData(txAs(tx), MAGAZA, { ...BAGLAM, storeId: null }),
    ).rejects.toBeInstanceOf(BadRequestException);

    dbyeHicGidilmedi(tx);
  });

  it('C — apply: context.storeId null FAIL-CLOSED', async () => {
    const { tx, market, adapter } = kur();
    const casus = jest.spyOn(market, 'teslimatBolgeleriYazTx');

    await expect(
      adapter.apply(txAs(tx), {
        entityId: MAGAZA,
        actionType: ChangeRequestAction.UPDATE,
        proposedData: veri,
        context: { ...BAGLAM, storeId: null },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(casus).not.toHaveBeenCalled();
    dbyeHicGidilmedi(tx);
  });

  it('C — validateProposedData: context.storeId null FAIL-CLOSED (davranis korundu)', async () => {
    const { tx, adapter } = kur();

    await expect(
      adapter.validateProposedData({ bolgeler: [] }, { ...BAGLAM, storeId: null }),
    ).rejects.toBeInstanceOf(BadRequestException);

    dbyeHicGidilmedi(tx);
  });

  // ---- D) entityId === context.storeId -> mutlu yol AYNEN calisir

  it('D — esit kimliklerde mutlu yol DEGISMEDI (apply + snapshot)', async () => {
    const { tx, market, adapter } = kur();
    const casus = jest.spyOn(market, 'teslimatBolgeleriYazTx');

    await adapter.apply(txAs(tx), {
      entityId: MAGAZA,
      actionType: ChangeRequestAction.UPDATE,
      proposedData: veri,
      context: BAGLAM,
    });

    expect(casus).toHaveBeenCalledTimes(1);
    expect(casus.mock.calls[0][1]).toBe(MAGAZA);

    const snapshot = (await adapter.buildBeforeData(
      txAs(tx),
      MAGAZA,
      BAGLAM,
    )) as DeliveryZoneSnapshot;
    expect(snapshot.revision).toBe(7);
  });
});

// ------------------------------------------------------------------ AUDIT-002
//
// BOYUT SINIRLARI PAYLASILAN DOGRULAYICIDA. Panel yolunda bu sinirlari DTO
// uyguluyor (@ArrayMaxSize(500), @MaxLength(80)); approval yolunda proposedData
// DTO'dan HIC gecmiyor. Testler ayni girdinin IKI yuzeyde de AYNI sonucu
// verdigini kanitliyor.

const IL_80 = 'A'.repeat(80);
const ILCE_80 = 'B'.repeat(80);

describe('AUDIT-002 — teslimat bolgesi boyut sinirlari', () => {
  /** 80 karakterlik il/ilce'yi platform kapsamina ekler (uzunluk siniri ile kapsam kurali ayrisabilsin diye). */
  function kapsamaUzunAdEkle(tx: SahteTx) {
    tx.platformHizmetBolgesi.findMany.mockResolvedValue([
      ...KAPSAM,
      { il: IL_80, ilce: ILCE_80, mahalle: null },
    ]);
  }

  const nSatir = (n: number) =>
    Array.from({ length: n }, () => ({ il: 'Diyarbakır', ilce: 'Kayapınar' }));

  it('1 — 500 satir KABUL edilir', async () => {
    const { tx, market } = kur();

    await expect(
      market.teslimatBolgeleriYazTx(txAs(tx), MAGAZA, nSatir(500), 7),
    ).resolves.toBeDefined();
  });

  it('2 — 501 satir REDDEDILIR (en ucuz kontrol; kapsam sorgusu hic acilmaz)', async () => {
    const { tx, market } = kur();

    await expect(
      market.teslimatBolgeleriYazTx(txAs(tx), MAGAZA, nSatir(501), 7),
    ).rejects.toThrow(/en fazla 500 satır/);

    expect(tx.platformHizmetBolgesi.findMany).not.toHaveBeenCalled();
    expect(tx.store.updateMany).not.toHaveBeenCalled();
  });

  it('3+5 — il ve ilce 80 karakter KABUL edilir', async () => {
    const { tx, market } = kur();
    kapsamaUzunAdEkle(tx);

    await expect(
      market.teslimatBolgeleriYazTx(txAs(tx), MAGAZA, [{ il: IL_80, ilce: ILCE_80 }], 7),
    ).resolves.toBeDefined();
  });

  it('4 — il 81 karakter REDDEDILIR (kapsam kontrolune bile gidilmez)', async () => {
    const { tx, market } = kur();
    kapsamaUzunAdEkle(tx);

    await expect(
      market.teslimatBolgeleriYazTx(txAs(tx), MAGAZA, [{ il: 'A'.repeat(81), ilce: ILCE_80 }], 7),
    ).rejects.toThrow(/İl adı en fazla 80 karakter/);

    expect(tx.platformHizmetBolgesi.findMany).not.toHaveBeenCalled();
    expect(tx.store.updateMany).not.toHaveBeenCalled();
  });

  it('6 — ilce 81 karakter REDDEDILIR', async () => {
    const { tx, market } = kur();
    kapsamaUzunAdEkle(tx);

    await expect(
      market.teslimatBolgeleriYazTx(txAs(tx), MAGAZA, [{ il: IL_80, ilce: 'B'.repeat(81) }], 7),
    ).rejects.toThrow(/İlçe adı en fazla 80 karakter/);

    expect(tx.store.updateMany).not.toHaveBeenCalled();
  });

  it('7 — mahalle 80 karakter KABUL edilir', async () => {
    const { tx, market } = kur();

    await expect(
      market.teslimatBolgeleriYazTx(
        txAs(tx),
        MAGAZA,
        [{ il: 'Diyarbakır', ilce: 'Kayapınar', mahalle: 'C'.repeat(80) }],
        7,
      ),
    ).resolves.toBeDefined();
  });

  it('8 — mahalle 81 karakter REDDEDILIR', async () => {
    const { tx, market } = kur();

    await expect(
      market.teslimatBolgeleriYazTx(
        txAs(tx),
        MAGAZA,
        [{ il: 'Diyarbakır', ilce: 'Kayapınar', mahalle: 'C'.repeat(81) }],
        7,
      ),
    ).rejects.toThrow(/Mahalle adı en fazla 80 karakter/);

    expect(tx.store.updateMany).not.toHaveBeenCalled();
  });

  it('9 — mahalle null: mevcut "ilcenin tamami" semantigi KORUNDU', async () => {
    const { tx, market } = kur();

    await market.teslimatBolgeleriYazTx(
      txAs(tx),
      MAGAZA,
      [{ il: 'Diyarbakır', ilce: 'Kayapınar', mahalle: null }],
      7,
    );

    expect(tx.magazaTeslimatBolgesi.createMany).toHaveBeenCalledWith({
      data: [
        { storeId: MAGAZA, il: 'Diyarbakır', ilce: 'Kayapınar', mahalle: null, feeKurus: null },
      ],
    });
  });

  it('10+11 — AYNI asiri girdi IKI yuzeyde de reddedilir (approval + paylasilan primitive)', async () => {
    const asiriMahalle = 'C'.repeat(81);
    const asiriGovde = {
      bolgeler: [{ il: 'Diyarbakır', ilce: 'Kayapınar', mahalle: asiriMahalle }],
    };

    // 10 — approval yolu: proposedData DTO'dan GECMEZ
    const a = kur();
    await expect(
      a.adapter.validateProposedData(asiriGovde, BAGLAM),
    ).rejects.toBeInstanceOf(BadRequestException);

    // 11 — panel/paylasilan primitive yolu: AYNI kural, AYNI sonuc
    const b = kur();
    await expect(
      b.market.teslimatBolgeleriYazTx(txAs(b.tx), MAGAZA, asiriGovde.bolgeler, 7),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(b.tx.store.updateMany).not.toHaveBeenCalled();
  });

  it('10+11 — adet siniri da iki yuzeyde AYNI', async () => {
    const govde = { bolgeler: nSatir(501) };

    const a = kur();
    await expect(a.adapter.validateProposedData(govde, BAGLAM)).rejects.toThrow(
      /en fazla 500 satır/,
    );

    const b = kur();
    await expect(
      b.market.teslimatBolgeleriYazTx(txAs(b.tx), MAGAZA, govde.bolgeler, 7),
    ).rejects.toThrow(/en fazla 500 satır/);
  });
});
