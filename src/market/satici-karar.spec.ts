// S4.2 — ADMIN BASVURU KARARI (PATCH /market/sellers/:id/karar) — BIRIM TESTLERI.
//
// Bu paket SOZLESMEYI kanitlar: gecis haritasi (CLOSED != REJECTED), DTO
// kapisi (main.ts ile AYNI ValidationPipe ayarlari), genel durum ucunun
// NEEDS_FIX/REJECTED icin kapali olmasi, kararin kosullu yazimi + audit'in
// AYNI tx'te yazilmasi, yanit allow-list'i ve yeniden gonderimde gerekce
// temizligi. Gercek DB davranisi (yaris, rollback, gercek izin matrisi, 401)
// ayri pakette: satici-karar.int.spec.ts.
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Role, SellerStatus, SellerVerification } from '@prisma/client';
import { MarketService } from './market.service';
import { SellerStatusService } from './seller-status.service';
import { SaticiKararDto } from './dto/seller.dto';
import { AuditService } from '../common/audit/audit.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { PrismaService } from '../prisma/prisma.service';

const SATICI_ID = '33333333-3333-3333-3333-333333333333';
const ADMIN_ID = '55555555-5555-5555-5555-555555555555';
const IZINLI_ANAHTARLAR = ['displayName', 'id', 'redGerekce', 'status', 'verification'];

// main.ts ile BIREBIR ayni ayarlar.
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
const dogrula = (govde: unknown) => pipe.transform(govde, { type: 'body', metatype: SaticiKararDto });

function tamSatir(ustuneYaz: Record<string, unknown> = {}) {
  return {
    id: SATICI_ID,
    ownerUserId: '44444444-4444-4444-4444-444444444444',
    displayName: 'Ornek Market',
    legalName: 'Ornek Ticaret',
    taxIdentifier: 'v1:iv:tag:SIFRELI-BLOB',
    taxLast4: '9999',
    status: SellerStatus.UNDER_REVIEW,
    verification: SellerVerification.BEKLIYOR,
    redGerekce: null as string | null,
    deletedAt: null,
    ...ustuneYaz,
  };
}

/** Select'e uyan sahte okuma: yalnizca istenen alanlari dondurur. */
function secileniDondur(satir: Record<string, unknown>, select?: Record<string, unknown>) {
  if (!select) return { ...satir };
  return Object.fromEntries(Object.entries(select).filter(([, v]) => v === true).map(([k]) => [k, satir[k]]));
}

function kur(opts: { satir?: Record<string, unknown> | null; guncellenen?: number; auditHata?: Error } = {}) {
  let satir = opts.satir === undefined ? tamSatir() : opts.satir;
  const tx = {
    seller: {
      updateMany: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const count = opts.guncellenen ?? 1;
        if (count > 0 && satir) satir = { ...satir, ...data };
        return { count };
      }),
      findUnique: jest.fn(async () => (satir ? { status: satir.status } : null)),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    seller: {
      findFirst: jest.fn(async ({ select }: { select?: Record<string, unknown> }) => (satir ? secileniDondur(satir, select) : null)),
      findUnique: jest.fn(async ({ select }: { select?: Record<string, unknown> }) => (satir ? secileniDondur(satir, select) : null)),
    },
  };
  const audit = {
    recordWithTx: jest.fn(async () => {
      if (opts.auditHata) throw opts.auditHata;
    }),
    record: jest.fn(),
  };
  const market = new MarketService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    new SellerStatusService(),
    {} as unknown as SozlesmeService,
  );
  return { market, prisma, tx, audit };
}

describe('S4.2 — gecis haritasi', () => {
  const h = new SellerStatusService().NEXT_STATUS;

  it('UNDER_REVIEW -> ACTIVE | NEEDS_FIX | REJECTED; CLOSED YOK', () => {
    expect([...h.UNDER_REVIEW].sort()).toEqual([SellerStatus.ACTIVE, SellerStatus.NEEDS_FIX, SellerStatus.REJECTED].sort());
    expect(h.UNDER_REVIEW).not.toContain(SellerStatus.CLOSED);
  });

  it('REJECTED terminal', () => {
    expect(h.REJECTED).toEqual([]);
  });

  it('CLOSED != REJECTED: REJECTED yalniz UNDER_REVIEW\'dan, CLOSED hicbir yerde REJECTED yerine gecmez', () => {
    const rejectedeGiden = Object.entries(h).filter(([, v]) => v.includes(SellerStatus.REJECTED)).map(([k]) => k);
    expect(rejectedeGiden).toEqual([SellerStatus.UNDER_REVIEW]);
    expect(h.CLOSED).toEqual([]);
  });

  it('diger mesru yasam dongusu gecisleri AYNEN duruyor', () => {
    expect(h.DRAFT).toEqual([SellerStatus.UNDER_REVIEW, SellerStatus.CLOSED]);
    expect(h.NEEDS_FIX).toEqual([SellerStatus.UNDER_REVIEW, SellerStatus.CLOSED]);
    expect(h.ACTIVE).toEqual([SellerStatus.SUSPENDED, SellerStatus.CLOSED]);
    expect(h.SUSPENDED).toEqual([SellerStatus.ACTIVE, SellerStatus.CLOSED]);
  });
});

describe('S4.2 — SaticiKararDto (main.ts ValidationPipe)', () => {
  it.each(['NEEDS_FIX', 'REJECTED'])('%s + gerekce gecer', async (karar) => {
    await expect(dogrula({ karar, gerekce: 'Vergi levhasi okunaksiz' })).resolves.toMatchObject({ karar });
  });

  it.each([
    ['eksik gerekce', { karar: 'REJECTED' }],
    ['bos gerekce', { karar: 'REJECTED', gerekce: '' }],
    ['yalniz bosluk', { karar: 'NEEDS_FIX', gerekce: '   \t\n ' }],
    ['metin olmayan gerekce', { karar: 'NEEDS_FIX', gerekce: 123 }],
    ['501 karakter', { karar: 'REJECTED', gerekce: 'x'.repeat(501) }],
    ['karar=CLOSED', { karar: 'CLOSED', gerekce: 'kapat' }],
    ['karar=ACTIVE', { karar: 'ACTIVE', gerekce: 'onay' }],
    ['karar eksik', { gerekce: 'neden' }],
    ['fazladan alan', { karar: 'REJECTED', gerekce: 'neden', status: 'ACTIVE' }],
  ])('%s -> 400', async (_ad, govde) => {
    await expect(dogrula(govde)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('500 karakter sinirda gecer', async () => {
    await expect(dogrula({ karar: 'REJECTED', gerekce: 'x'.repeat(500) })).resolves.toBeDefined();
  });
});

describe('S4.2 — saticiKarar', () => {
  it.each([
    ['NEEDS_FIX', SellerStatus.NEEDS_FIX, 'seller.needs_fix'],
    ['REJECTED', SellerStatus.REJECTED, 'seller.reject'],
  ] as const)('UNDER_REVIEW -> %s: kosullu yazim + ayni tx\'te tek audit', async (karar, hedef, action) => {
    const { market, prisma, tx, audit } = kur();

    const r = await market.saticiKarar([Role.ADMIN], SATICI_ID, karar, '  Belge eksik  ', { id: ADMIN_ID, ip: '10.1.1.1' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.seller.updateMany).toHaveBeenCalledWith({
      where: { id: SATICI_ID, status: { in: [SellerStatus.UNDER_REVIEW] } },
      data: { status: hedef, redGerekce: 'Belge eksik' },
    });
    expect(audit.recordWithTx).toHaveBeenCalledTimes(1);
    expect(audit.recordWithTx).toHaveBeenCalledWith(tx, {
      actorId: ADMIN_ID, action, entity: 'Seller', entityId: SATICI_ID, ip: '10.1.1.1',
      metadata: { from: SellerStatus.UNDER_REVIEW, to: hedef, gerekce: 'Belge eksik' },
    });
    expect(audit.record).not.toHaveBeenCalled();
    expect(r).toEqual({
      id: SATICI_ID, status: hedef, verification: SellerVerification.BEKLIYOR,
      displayName: 'Ornek Market', redGerekce: 'Belge eksik',
    });
  });

  it('yanit ALLOW-LIST: DB\'ye giden select yalniz izinli alanlar, gizli alan yok', async () => {
    const { market, prisma } = kur();

    const r = await market.saticiKarar([Role.SUPER_ADMIN], SATICI_ID, 'REJECTED', 'Sahte belge', { id: ADMIN_ID });

    const select = prisma.seller.findUnique.mock.calls.at(-1)![0].select!;
    expect(Object.keys(select).sort()).toEqual(IZINLI_ANAHTARLAR);
    expect(Object.keys(r!).sort()).toEqual(IZINLI_ANAHTARLAR);
    const metin = JSON.stringify(r);
    expect(metin).not.toContain('SIFRELI-BLOB');
    expect(metin).not.toContain('44444444');
  });

  it.each([[Role.CUSTOMER], [Role.MERCHANT]])('%s -> 403, DB\'ye dokunulmaz', async (rol) => {
    const { market, prisma, audit } = kur();
    await expect(market.saticiKarar([rol], SATICI_ID, 'REJECTED', 'x', { id: ADMIN_ID })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.seller.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.recordWithTx).not.toHaveBeenCalled();
  });

  it('servis dogrudan cagrilsa bile yalniz bosluk gerekce 400', async () => {
    const { market, prisma } = kur();
    await expect(market.saticiKarar([Role.ADMIN], SATICI_ID, 'NEEDS_FIX', '   ', { id: ADMIN_ID })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('satici yok -> 404', async () => {
    const { market, prisma } = kur({ satir: null });
    await expect(market.saticiKarar([Role.ADMIN], SATICI_ID, 'REJECTED', 'x', { id: ADMIN_ID })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    SellerStatus.DRAFT, SellerStatus.NEEDS_FIX, SellerStatus.ACTIVE, SellerStatus.SUSPENDED,
    SellerStatus.CLOSED, SellerStatus.REJECTED,
  ])('baslangic %s -> 409, audit YAZILMAZ', async (status) => {
    const { market, audit } = kur({ satir: tamSatir({ status }), guncellenen: 0 });
    await expect(market.saticiKarar([Role.ADMIN], SATICI_ID, 'REJECTED', 'x', { id: ADMIN_ID })).rejects.toBeInstanceOf(ConflictException);
    expect(audit.recordWithTx).not.toHaveBeenCalled();
  });

  it('audit hatasi yutulmaz: karar cagrisi reddedilir (rollback gercek DB\'de int pakette)', async () => {
    const { market } = kur({ auditHata: new Error('audit yazilamadi') });
    await expect(market.saticiKarar([Role.ADMIN], SATICI_ID, 'NEEDS_FIX', 'x', { id: ADMIN_ID })).rejects.toThrow('audit yazilamadi');
  });
});

describe('S4.2 — genel durum ucu (saticiDurumDegistir) bypass kapisi', () => {
  it.each([SellerStatus.NEEDS_FIX, SellerStatus.REJECTED])('hedef %s -> 400, DB\'ye dokunulmaz', async (hedef) => {
    const { market, prisma } = kur();
    await expect(market.saticiDurumDegistir([Role.ADMIN], SATICI_ID, hedef)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.seller.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('UNDER_REVIEW -> CLOSED artik 409', async () => {
    const { market, prisma } = kur();
    await expect(market.saticiDurumDegistir([Role.ADMIN], SATICI_ID, SellerStatus.CLOSED)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('REGRESYON: UNDER_REVIEW -> ACTIVE (dogrulama ONAYLANDI) hala calisir', async () => {
    const { market, tx } = kur({ satir: tamSatir({ verification: SellerVerification.ONAYLANDI }) });
    await expect(market.saticiDurumDegistir([Role.ADMIN], SATICI_ID, SellerStatus.ACTIVE)).resolves.toMatchObject({ status: SellerStatus.ACTIVE });
    expect(tx.seller.updateMany).toHaveBeenCalledWith({
      where: { id: SATICI_ID, status: { in: [SellerStatus.UNDER_REVIEW] } },
      data: { status: SellerStatus.ACTIVE },
    });
  });

  it('REGRESYON: ACTIVE -> CLOSED hala calisir', async () => {
    const { market } = kur({ satir: tamSatir({ status: SellerStatus.ACTIVE }) });
    await expect(market.saticiDurumDegistir([Role.ADMIN], SATICI_ID, SellerStatus.CLOSED)).resolves.toMatchObject({ status: SellerStatus.CLOSED });
  });
});

describe('S4.2 — yeniden gonderim (saticiOnayaGonder)', () => {
  it('NEEDS_FIX -> UNDER_REVIEW ayni kosullu yazimda redGerekce = null', async () => {
    const { market, tx } = kur({ satir: tamSatir({ status: SellerStatus.NEEDS_FIX, redGerekce: 'Eski gerekce' }) });
    // saticim() sonrasi okuma bu testin konusu degil.
    jest.spyOn(market, 'saticim').mockResolvedValue({} as never);
    // saticimHam select'siz findFirst kullaniyor.
    await market.saticiOnayaGonder('44444444-4444-4444-4444-444444444444');

    expect(tx.seller.updateMany).toHaveBeenCalledWith({
      where: { id: SATICI_ID, status: { in: [SellerStatus.DRAFT, SellerStatus.NEEDS_FIX] } },
      data: { status: SellerStatus.UNDER_REVIEW, redGerekce: null },
    });
  });
});
