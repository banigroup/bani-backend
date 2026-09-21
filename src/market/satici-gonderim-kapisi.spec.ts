// 02 — BASVURU GONDERIM KAPISI (POST /market/seller/submit) — BIRIM TESTLERI.
//
// Bu paket SOZLESMEYI kanitlar: bes sartin her biri ayri ayri gecisi engeller,
// eksikler TEK yanitta makine okunur kodlarla doner, hicbir eksikte DB'ye
// YAZILMAZ ve butun sartlar saglandiginda kosullu gecis (CAS) aynen calisir.
//
// GERCEK DB davranisi (yaris, gercek sozlesme surumleri, eski surum onayinin
// yeni aktif surum yerine gecmemesi) ayri pakette:
// satici-gonderim-kapisi.int.spec.ts.
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import {
  SaticiBelgeDurum,
  SaticiBelgeTipi,
  SellerStatus,
  SellerVerification,
  SozlesmeTipi,
} from '@prisma/client';
import { MarketService } from './market.service';
import { SellerStatusService } from './seller-status.service';
import { AuditService } from '../common/audit/audit.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { PrismaService } from '../prisma/prisma.service';

const KULLANICI = '11111111-1111-1111-1111-111111111111';
const SATICI_ID = '22222222-2222-2222-2222-222222222222';

type Belge = { tip: SaticiBelgeTipi; durum: SaticiBelgeDurum; deletedAt: Date | null };

function saticiSatiri(ustuneYaz: Record<string, unknown> = {}) {
  return {
    id: SATICI_ID,
    ownerUserId: KULLANICI,
    legalName: 'Ornek Ticaret',
    displayName: 'Ornek Market',
    taxIdentifier: 'v1:iv:tag:SIFRELI-BLOB',
    taxLast4: '9999',
    status: SellerStatus.DRAFT,
    verification: SellerVerification.EKSIK,
    redGerekce: 'eski gerekce',
    deletedAt: null,
    stores: [],
    ...ustuneYaz,
  };
}

/**
 * Sahte prisma: saticiBelge.findFirst GERCEKTEN suzer.
 *
 * Kritik: "yalnizca REDDEDILDI levha var" senaryosunun kaniti, servisin
 * where'ine yazdigi durum filtresidir. Mock kosulsuz null dondurseydi test
 * filtreyi degil kendi kurgusunu dogrulamis olurdu.
 */
function kur(opts: { satici?: Record<string, unknown>; belgeler?: Belge[]; guncellenen?: number } = {}) {
  const satir = saticiSatiri(opts.satici ?? {});
  const belgeler = opts.belgeler ?? [];
  const tx = {
    seller: {
      updateMany: jest.fn(async (_args: Record<string, any>) => ({ count: opts.guncellenen ?? 1 })),
      findUnique: jest.fn(async () => ({ status: satir.status })),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    seller: {
      // saticimHam select'siz, saticim select'li cagiriyor; ikisi de ayni satir.
      findFirst: jest.fn(async () => ({ ...satir })),
    },
    saticiBelge: {
      findFirst: jest.fn(async ({ where }: { where: Record<string, any> }) => {
        const izinli: SaticiBelgeDurum[] = where.durum?.in ?? [];
        const bulunan = belgeler.find(
          (b) => b.tip === where.tip && b.deletedAt === where.deletedAt && izinli.includes(b.durum),
        );
        return bulunan ? { id: 'belge-id' } : null;
      }),
    },
  };
  const sozlesme = {
    onayliMi: jest.fn(async (_userId: string, _tip: SozlesmeTipi) => true),
  };
  const market = new MarketService(
    prisma as unknown as PrismaService,
    { record: jest.fn(), recordWithTx: jest.fn() } as unknown as AuditService,
    new SellerStatusService(),
    sozlesme as unknown as SozlesmeService,
  );
  return { market, prisma, tx, sozlesme };
}

const LEVHA_BEKLIYOR: Belge = {
  tip: SaticiBelgeTipi.VERGI_LEVHASI,
  durum: SaticiBelgeDurum.BEKLIYOR,
  deletedAt: null,
};

/** Hatanin govdesindeki eksik kodlari. */
function eksikKodlari(e: unknown): string[] {
  const govde = (e as ConflictException).getResponse() as { eksikler?: { kod: string }[] };
  return (govde.eksikler ?? []).map((x) => x.kod);
}

async function gonderHatasi(market: MarketService) {
  try {
    await market.saticiOnayaGonder(KULLANICI);
  } catch (e) {
    return e;
  }
  throw new Error('Gonderim beklenmedik sekilde BASARILI oldu');
}

describe('02 — submit kapisi: eksik sartlar', () => {
  it('1. taxIdentifier yok -> 409, kod VERGI_KIMLIGI, DB YAZILMAZ', async () => {
    const { market, prisma } = kur({ satici: { taxIdentifier: null }, belgeler: [LEVHA_BEKLIYOR] });
    const e = await gonderHatasi(market);
    expect(e).toBeInstanceOf(ConflictException);
    expect(eksikKodlari(e)).toEqual(['VERGI_KIMLIGI']);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('2. legalName yok -> 409, kod TICARI_UNVAN', async () => {
    const { market } = kur({ satici: { legalName: '   ' }, belgeler: [LEVHA_BEKLIYOR] });
    expect(eksikKodlari(await gonderHatasi(market))).toEqual(['TICARI_UNVAN']);
  });

  it('3. VERGI_LEVHASI hic yok -> 409, kod VERGI_LEVHASI', async () => {
    const { market } = kur({ belgeler: [] });
    expect(eksikKodlari(await gonderHatasi(market))).toEqual(['VERGI_LEVHASI']);
  });

  it('4. yalnizca REDDEDILDI levha var -> 409 (red belge sarti KARSILAMAZ)', async () => {
    const { market } = kur({
      belgeler: [{ tip: SaticiBelgeTipi.VERGI_LEVHASI, durum: SaticiBelgeDurum.REDDEDILDI, deletedAt: null }],
    });
    expect(eksikKodlari(await gonderHatasi(market))).toEqual(['VERGI_LEVHASI']);
  });

  it('4b. ONAYLANDI levha da sarti KARSILAR (onay sart degil ama engel de degil)', async () => {
    const { market, tx } = kur({
      belgeler: [{ tip: SaticiBelgeTipi.VERGI_LEVHASI, durum: SaticiBelgeDurum.ONAYLANDI, deletedAt: null }],
    });
    await market.saticiOnayaGonder(KULLANICI);
    expect(tx.seller.updateMany).toHaveBeenCalled();
  });

  it('4c. baska tipte belge levha yerine GECMEZ', async () => {
    const { market } = kur({
      belgeler: [{ tip: SaticiBelgeTipi.KIMLIK, durum: SaticiBelgeDurum.BEKLIYOR, deletedAt: null }],
    });
    expect(eksikKodlari(await gonderHatasi(market))).toEqual(['VERGI_LEVHASI']);
  });

  it('5. SATICI sozlesmesi onaysiz -> 409, kod SOZLESME_SATICI', async () => {
    const { market, sozlesme } = kur({ belgeler: [LEVHA_BEKLIYOR] });
    sozlesme.onayliMi.mockImplementation(async (_u: string, tip: SozlesmeTipi) => tip !== SozlesmeTipi.SATICI);
    expect(eksikKodlari(await gonderHatasi(market))).toEqual(['SOZLESME_SATICI']);
  });

  it('6. SATICI_KOMISYON onaysiz -> 409, kod SOZLESME_SATICI_KOMISYON', async () => {
    const { market, sozlesme } = kur({ belgeler: [LEVHA_BEKLIYOR] });
    sozlesme.onayliMi.mockImplementation(
      async (_u: string, tip: SozlesmeTipi) => tip !== SozlesmeTipi.SATICI_KOMISYON,
    );
    expect(eksikKodlari(await gonderHatasi(market))).toEqual(['SOZLESME_SATICI_KOMISYON']);
  });

  it('her iki sozlesme tipi de SORULUR (komisyon atlanmaz)', async () => {
    const { market, sozlesme } = kur({ belgeler: [LEVHA_BEKLIYOR] });
    await market.saticiOnayaGonder(KULLANICI);
    const sorulanlar = sozlesme.onayliMi.mock.calls.map((c: unknown[]) => c[1]);
    expect(sorulanlar).toEqual(expect.arrayContaining([SozlesmeTipi.SATICI, SozlesmeTipi.SATICI_KOMISYON]));
  });

  it('eksiklerin HEPSI tek yanitta doner', async () => {
    const { market } = kur({ satici: { taxIdentifier: null, legalName: '' }, belgeler: [] });
    const { market: m2, sozlesme } = kur({ satici: { taxIdentifier: null }, belgeler: [] });
    sozlesme.onayliMi.mockResolvedValue(false);

    expect(eksikKodlari(await gonderHatasi(market))).toEqual(['VERGI_KIMLIGI', 'TICARI_UNVAN', 'VERGI_LEVHASI']);
    expect(eksikKodlari(await gonderHatasi(m2))).toEqual([
      'VERGI_KIMLIGI', 'VERGI_LEVHASI', 'SOZLESME_SATICI', 'SOZLESME_SATICI_KOMISYON',
    ]);
  });

  it('mesaj DUZ METIN kalir (panel [object Object] gostermesin)', async () => {
    const { market } = kur({ satici: { taxIdentifier: null }, belgeler: [LEVHA_BEKLIYOR] });
    const govde = (await gonderHatasi(market) as ConflictException).getResponse() as { message: unknown };
    expect(typeof govde.message).toBe('string');
    expect(govde.message).toContain('Vergi bilgileri eksik');
  });
});

describe('02 — submit kapisi: sozlesme YAYINLANMAMIS', () => {
  it('7. aktif surum yoksa 503 doner ve DB\'ye YAZILMAZ', async () => {
    const { market, prisma, sozlesme } = kur({ belgeler: [LEVHA_BEKLIYOR] });
    sozlesme.onayliMi.mockImplementation(async (_u: string, tip: SozlesmeTipi) => {
      if (tip === SozlesmeTipi.SATICI_KOMISYON) throw new ServiceUnavailableException('yok');
      return true;
    });
    const e = await gonderHatasi(market);
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    expect((e as ServiceUnavailableException).message).toContain('SATICI_KOMISYON');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('yayinlanmamis sozlesme, duzeltilebilir eksiklerin ONUNE gecer', async () => {
    const { market, sozlesme } = kur({ satici: { taxIdentifier: null }, belgeler: [] });
    sozlesme.onayliMi.mockRejectedValue(new ServiceUnavailableException('yok'));
    expect(await gonderHatasi(market)).toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('02 — submit kapisi: butun sartlar tamam', () => {
  it('8. DRAFT -> UNDER_REVIEW, redGerekce temizlenir, kosullu yazim korunur', async () => {
    const { market, tx } = kur({ belgeler: [LEVHA_BEKLIYOR] });
    await market.saticiOnayaGonder(KULLANICI);

    expect(tx.seller.updateMany).toHaveBeenCalledTimes(1);
    const cagri = tx.seller.updateMany.mock.calls[0][0] as unknown as {
      where: { id: string; status: { in: SellerStatus[] } };
      data: { status: SellerStatus; redGerekce: null };
    };
    expect(cagri.where.id).toBe(SATICI_ID);
    // CAS KORUNDU: yalnizca DRAFT|NEEDS_FIX'ten gecilir.
    expect(cagri.where.status.in).toEqual([SellerStatus.DRAFT, SellerStatus.NEEDS_FIX]);
    expect(cagri.data).toEqual({ status: SellerStatus.UNDER_REVIEW, redGerekce: null });
  });

  it('9. kaybeden es zamanli gonderim 409 alir (CAS 0 satir)', async () => {
    const { market } = kur({ belgeler: [LEVHA_BEKLIYOR], guncellenen: 0 });
    expect(await gonderHatasi(market)).toBeInstanceOf(ConflictException);
  });

  it('NEEDS_FIX de gecerli baslangic durumudur', async () => {
    const { market, tx } = kur({ satici: { status: SellerStatus.NEEDS_FIX }, belgeler: [LEVHA_BEKLIYOR] });
    await market.saticiOnayaGonder(KULLANICI);
    expect(tx.seller.updateMany).toHaveBeenCalledTimes(1);
  });
});
