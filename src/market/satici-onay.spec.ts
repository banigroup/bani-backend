// S4.3 — ADMIN BASVURU ONAYI (PATCH /market/sellers/:id/onay) — BIRIM TESTLERI.
//
// Bu paket SOZLESMEYI kanitlar: kapi sirasi (satici -> owner -> CAS -> rol ->
// audit), CAS'in dogrulamayi WHERE'de tasimasi, MERCHANT'in ADDITIVE yazilmasi
// (silme cagrisi YOK), audit yukunun sekli, yanit allow-list'i ve genel durum
// ucunun UNDER_REVIEW -> ACTIVE icin kapali olmasi. Gercek DB davranisi
// (rollback, yaris, gercek roller, 401) ayri pakette: satici-onay.int.spec.ts.
//
// SAHTE TX = KATI: yalniz tanimli metotlar var. rolleriYaz'in kullandigi
// deleteMany/createMany gibi bir metoda dokunulursa TypeError ile test duser.
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role, SellerStatus, SellerVerification, UserStatus } from '@prisma/client';
import { MarketService } from './market.service';
import { SellerStatusService } from './seller-status.service';
import { AuditService } from '../common/audit/audit.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { PrismaService } from '../prisma/prisma.service';

const SATICI_ID = '33333333-3333-3333-3333-333333333333';
const SAHIP_ID = '44444444-4444-4444-4444-444444444444';
const ADMIN_ID = '55555555-5555-5555-5555-555555555555';

function kur(opts: {
  satici?: Record<string, unknown> | null;
  owner?: Record<string, unknown> | null;
  merchantVar?: boolean;
  casSayisi?: number;
} = {}) {
  const satici = opts.satici === undefined
    ? {
        id: SATICI_ID, ownerUserId: SAHIP_ID, displayName: 'Ornek Market',
        taxIdentifier: 'v1:iv:tag:SIFRELI-BLOB', status: SellerStatus.UNDER_REVIEW,
        verification: SellerVerification.ONAYLANDI,
      }
    : opts.satici;
  const owner = opts.owner === undefined ? { status: UserStatus.ACTIVE, deletedAt: null } : opts.owner;
  const sira: string[] = [];

  const tx = {
    seller: {
      findFirst: jest.fn(async () => { sira.push('seller.findFirst'); return satici; }),
      updateMany: jest.fn(async () => {
        sira.push('seller.updateMany');
        const count = opts.casSayisi ?? 1;
        if (count > 0 && satici) satici.status = SellerStatus.ACTIVE;
        return { count };
      }),
      findUnique: jest.fn(async () => satici && { status: satici.status, verification: satici.verification }),
      findUniqueOrThrow: jest.fn(async ({ select }: { select: Record<string, boolean> }) =>
        Object.fromEntries(Object.keys(select).map((k) => [k, satici![k]]))),
    },
    user: {
      findUnique: jest.fn(async () => { sira.push('user.findUnique'); return owner; }),
    },
    userRole: {
      findFirst: jest.fn(async () => { sira.push('userRole.findFirst'); return opts.merchantVar ? { id: 'r1' } : null; }),
      create: jest.fn(async () => { sira.push('userRole.create'); return { id: 'r2' }; }),
    },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  const audit = {
    recordWithTx: jest.fn(async () => { sira.push('audit'); }),
    record: jest.fn(),
  };
  const market = new MarketService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    new SellerStatusService(),
    {} as unknown as SozlesmeService,
  );
  return { market, prisma, tx, audit, sira };
}

const onayla = (market: MarketService, roles: Role[] = [Role.ADMIN]) =>
  market.saticiOnayla(roles, SATICI_ID, { id: ADMIN_ID, ip: '10.4.3.1' });

describe('S4.3 — saticiOnayla basari yolu', () => {
  it('sira: satici -> owner -> CAS -> MERCHANT kontrolu -> create -> audit; hepsi TEK tx', async () => {
    const { market, prisma, sira } = kur();
    await onayla(market);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(sira).toEqual(['seller.findFirst', 'user.findUnique', 'seller.updateMany', 'userRole.findFirst', 'userRole.create', 'audit']);
  });

  it('satici okumasi silik kaydi dislar; CAS WHERE status + verification + deletedAt tasir', async () => {
    const { market, tx } = kur();
    await onayla(market);
    expect(tx.seller.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: SATICI_ID, deletedAt: null } }));
    expect(tx.seller.updateMany).toHaveBeenCalledWith({
      where: {
        id: SATICI_ID, deletedAt: null,
        status: SellerStatus.UNDER_REVIEW, verification: SellerVerification.ONAYLANDI,
      },
      data: { status: SellerStatus.ACTIVE },
    });
  });

  it('MERCHANT yoksa platform kapsaminda (storeId null) ADDITIVE create', async () => {
    const { market, tx } = kur();
    await onayla(market);
    expect(tx.userRole.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: SAHIP_ID, role: Role.MERCHANT, storeId: null },
    }));
    expect(tx.userRole.create).toHaveBeenCalledWith({ data: { userId: SAHIP_ID, role: Role.MERCHANT, storeId: null } });
  });

  it('audit: seller.approve, ayni tx, roleAdded=MERCHANT; controller-tipi record() YOK', async () => {
    const { market, tx, audit } = kur();
    await onayla(market);
    expect(audit.recordWithTx).toHaveBeenCalledTimes(1);
    expect(audit.recordWithTx).toHaveBeenCalledWith(tx, {
      actorId: ADMIN_ID, action: 'seller.approve', entity: 'Seller', entityId: SATICI_ID, ip: '10.4.3.1',
      metadata: { from: SellerStatus.UNDER_REVIEW, to: SellerStatus.ACTIVE, roleAdded: Role.MERCHANT },
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('MERCHANT zaten varsa: basari, create YOK, roleAdded=null, merchantRolu=ZATEN_VARDI', async () => {
    const { market, tx, audit } = kur({ merchantVar: true });
    const r = await onayla(market);
    expect(tx.userRole.create).not.toHaveBeenCalled();
    expect(audit.recordWithTx).toHaveBeenCalledWith(tx, expect.objectContaining({
      metadata: { from: SellerStatus.UNDER_REVIEW, to: SellerStatus.ACTIVE, roleAdded: null },
    }));
    expect(r.merchantRolu).toBe('ZATEN_VARDI');
  });

  it('yanit allow-list: yalniz id/status/verification/displayName + merchantRolu', async () => {
    const { market, tx } = kur();
    const r = await onayla(market);
    const select = tx.seller.findUniqueOrThrow.mock.calls[0][0].select;
    expect(Object.keys(select).sort()).toEqual(['displayName', 'id', 'status', 'verification']);
    expect(r).toEqual({
      id: SATICI_ID, status: SellerStatus.ACTIVE, verification: SellerVerification.ONAYLANDI,
      displayName: 'Ornek Market', merchantRolu: 'EKLENDI',
    });
    const metin = JSON.stringify(r);
    expect(metin).not.toContain('SIFRELI-BLOB');
    expect(metin).not.toContain(SAHIP_ID);
  });

  it('ADMIN ve SUPER_ADMIN gecer', async () => {
    await expect(onayla(kur().market, [Role.ADMIN])).resolves.toBeDefined();
    await expect(onayla(kur().market, [Role.SUPER_ADMIN])).resolves.toBeDefined();
  });
});

describe('S4.3 — saticiOnayla ret yollari (HICBIR yazma yok)', () => {
  const yazmaYok = (k: ReturnType<typeof kur>) => {
    expect(k.tx.seller.updateMany).not.toHaveBeenCalled();
    expect(k.tx.userRole.create).not.toHaveBeenCalled();
    expect(k.audit.recordWithTx).not.toHaveBeenCalled();
  };

  it.each([[Role.CUSTOMER], [Role.MERCHANT]])('%s -> 403, tx acilmaz', async (rol) => {
    const k = kur();
    await expect(onayla(k.market, [rol])).rejects.toBeInstanceOf(ForbiddenException);
    expect(k.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('satici yok / silik -> 404', async () => {
    const k = kur({ satici: null });
    await expect(onayla(k.market)).rejects.toBeInstanceOf(NotFoundException);
    yazmaYok(k);
  });

  it.each([
    SellerStatus.DRAFT, SellerStatus.NEEDS_FIX, SellerStatus.ACTIVE, SellerStatus.SUSPENDED,
    SellerStatus.CLOSED, SellerStatus.REJECTED,
  ])('status %s -> 409', async (status) => {
    const k = kur({
      satici: { id: SATICI_ID, ownerUserId: SAHIP_ID, status, verification: SellerVerification.ONAYLANDI },
    });
    await expect(onayla(k.market)).rejects.toBeInstanceOf(ConflictException);
    yazmaYok(k);
  });

  it.each([
    SellerVerification.EKSIK, SellerVerification.BEKLIYOR, SellerVerification.REDDEDILDI, SellerVerification.SURESI_DOLDU,
  ])('verification %s -> 409', async (verification) => {
    const k = kur({
      satici: { id: SATICI_ID, ownerUserId: SAHIP_ID, status: SellerStatus.UNDER_REVIEW, verification },
    });
    await expect(onayla(k.market)).rejects.toBeInstanceOf(ConflictException);
    yazmaYok(k);
  });

  it.each([
    ['yok', null],
    ['soft-deleted', { status: UserStatus.ACTIVE, deletedAt: new Date() }],
    ['SUSPENDED', { status: UserStatus.SUSPENDED, deletedAt: null }],
    ['BANNED', { status: UserStatus.BANNED, deletedAt: null }],
    ['DELETED', { status: UserStatus.DELETED, deletedAt: null }],
    ['PENDING', { status: UserStatus.PENDING, deletedAt: null }],
  ])('owner %s -> 409, satici ACTIVE yapilmaz', async (_ad, owner) => {
    const k = kur({ owner });
    await expect(onayla(k.market)).rejects.toBeInstanceOf(ConflictException);
    yazmaYok(k);
  });

  it('CAS 0 satir (araya giren degisiklik) -> 409, rol ve audit adimina ulasilmaz', async () => {
    const k = kur({ casSayisi: 0 });
    await expect(onayla(k.market)).rejects.toBeInstanceOf(ConflictException);
    expect(k.tx.userRole.findFirst).not.toHaveBeenCalled();
    expect(k.tx.userRole.create).not.toHaveBeenCalled();
    expect(k.audit.recordWithTx).not.toHaveBeenCalled();
  });
});

describe('S4.3 — genel durum ucu (saticiDurumDegistir)', () => {
  function genelKur(status: SellerStatus) {
    const satir = { id: SATICI_ID, status, verification: SellerVerification.ONAYLANDI, displayName: 'Ornek Market' };
    const tx = { seller: { updateMany: jest.fn(async () => ({ count: 1 })), findUnique: jest.fn() } };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      seller: { findUnique: jest.fn(async () => satir) },
    };
    const market = new MarketService(
      prisma as unknown as PrismaService, {} as unknown as AuditService, new SellerStatusService(), {} as unknown as SozlesmeService,
    );
    return { market, prisma, tx };
  }

  it('UNDER_REVIEW -> ACTIVE -> 409, yazma yok', async () => {
    const { market, prisma } = genelKur(SellerStatus.UNDER_REVIEW);
    await expect(market.saticiDurumDegistir([Role.ADMIN], SATICI_ID, SellerStatus.ACTIVE)).rejects.toThrow(
      new ConflictException('Başvuru onayı yalnızca satıcı onay ucundan (PATCH sellers/:id/onay) yapılabilir'),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('REGRESYON: SUSPENDED -> ACTIVE calisir', async () => {
    const { market, tx } = genelKur(SellerStatus.SUSPENDED);
    await market.saticiDurumDegistir([Role.ADMIN], SATICI_ID, SellerStatus.ACTIVE);
    expect(tx.seller.updateMany).toHaveBeenCalledWith({
      where: { id: SATICI_ID, status: { in: [SellerStatus.SUSPENDED] } },
      data: { status: SellerStatus.ACTIVE },
    });
  });

  it('gecis haritasi DEGISMEDI: UNDER_REVIEW -> ACTIVE onay ucu icin hala tanimli', () => {
    expect(new SellerStatusService().NEXT_STATUS.UNDER_REVIEW).toContain(SellerStatus.ACTIVE);
  });
});
