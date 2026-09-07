// APPROVAL SERVICE DAVRANIS TESTLERI (CORE-3 / D126 + C3A-001 regresyonu).
//
// @nestjs/testing KULLANILMAZ (D132): servisin uc bagimliligi da konumsal
// constructor parametresi oldugu icin dogrudan `new ApprovalService(...)` yeterli;
// Nest DI konteynerine ozgu test edilecek bir davranis YOK (modul AppModule'e
// baglanmiyor - D122).
//
// TEK tx NESNESI: butun sahte Prisma model metodlari ayni nesnede yasar ve
// $transaction geri cagirimina O nesne verilir. Boylece "hepsi ayni transaction
// icinde mi" (D117) sorusu, cagri argumaninin ayni referans olmasiyla dogrulanir.
//
// C3A-001: approve/reject artik KOSULLU SAHIPLENME (updateMany + status=PENDING
// WHERE + count kontrolu) kullaniyor. Kaybeden transaction ConflictException alir
// ve apply/audit HIC calismaz. Sira, kaynak satirina degil RUNTIME cagri sirasina
// (mock.invocationCallOrder) bakilarak dogrulanir.
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChangeRequestAction, ChangeRequestStatus } from '@prisma/client';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdapterRegistry } from './adapter/adapter-registry';
import {
  ApprovalService,
  ApprovalSubmitInput,
  snapshotEsit,
} from './approval.service';

// ---------------------------------------------------------------- sahte altyapi

type SahteTx = ReturnType<typeof txKur>;

function txKur() {
  return {
    changeRequest: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    store: { findUnique: jest.fn() },
    storeUser: { findFirst: jest.fn() },
  };
}

function adapterKur() {
  return {
    entityType: 'STORE',
    validateProposedData: jest.fn(),
    buildBeforeData: jest.fn(),
    revalidateCurrentState: jest.fn(),
    apply: jest.fn(),
  };
}

const TALEP_SAHIBI = 'user-requester';
const INCELEYEN = 'user-reviewer';
const MAGAZA = 'store-1';

interface KurulumSecenek {
  txHatasi?: unknown;
}

function kur(secenek: KurulumSecenek = {}) {
  const tx = txKur();
  const adapter = adapterKur();

  // VARSAYILAN SAHIPLENME BASARILI: mutlu yol testleri yanlislikla count=0
  // almasin. Kayip-sahiplenme testleri bunu acikca ezer.
  tx.changeRequest.updateMany.mockResolvedValue({ count: 1 });
  tx.changeRequest.findUniqueOrThrow.mockResolvedValue(talepKur());

  const prisma = {
    $transaction: jest.fn(async (geriCagirim: (t: SahteTx) => unknown) => {
      if (secenek.txHatasi !== undefined) throw secenek.txHatasi;
      return geriCagirim(tx);
    }),
  };
  const registry = { resolve: jest.fn(() => adapter) };
  // Parametreler ACIKCA tiplenir: aksi halde jest.fn() sifir-argumanli cikarilir ve
  // mock.calls[0][0] (ayni-tx dogrulamasi) tip hatasi verir.
  const audit = {
    recordWithTx: jest.fn(
      async (_tx: unknown, _kayit: Record<string, unknown>): Promise<void> => undefined,
    ),
  };

  const service = new ApprovalService(
    prisma as unknown as PrismaService,
    registry as unknown as AdapterRegistry,
    audit as unknown as AuditService,
  );

  return { service, tx, adapter, prisma, registry, audit };
}

/** Testlerde okunan ChangeRequest satirinin varsayilan sekli. */
function talepKur(ustuneYaz: Record<string, unknown> = {}) {
  return {
    id: 'cr-1',
    entityType: 'STORE',
    entityId: 'entity-1',
    actionType: ChangeRequestAction.UPDATE,
    storeId: MAGAZA,
    businessUnit: null,
    status: ChangeRequestStatus.PENDING,
    requestedById: TALEP_SAHIBI,
    reviewedById: null,
    proposedData: { ad: 'yeni' },
    beforeData: { ad: 'eski' },
    rejectionReason: null,
    supersedesId: null,
    ...ustuneYaz,
  };
}

function submitGirdi(ustuneYaz: Partial<ApprovalSubmitInput> = {}): ApprovalSubmitInput {
  return {
    entityType: 'STORE',
    entityId: 'entity-1',
    actionType: ChangeRequestAction.UPDATE,
    storeId: MAGAZA,
    businessUnit: null,
    proposedData: { ad: 'ham' },
    requestedById: TALEP_SAHIBI,
    ...ustuneYaz,
  };
}

/** Bagimsiz reviewer: magaza var, sahibi baskasi, aktif personel kaydi yok. */
function bagimsizReviewerKur(tx: SahteTx) {
  tx.store.findUnique.mockResolvedValue({ ownerId: 'baska-sahip' });
  tx.storeUser.findFirst.mockResolvedValue(null);
}

/** Runtime cagri sirasi (kaynak satir sirasi DEGIL). */
function cagriSirasi(sahte: jest.Mock): number {
  return sahte.mock.invocationCallOrder[0];
}

// ---------------------------------------------------------------- A — SUBMIT

describe('ApprovalService.submit', () => {
  it('A — adapter dogrulamasindan gecen NORMALIZE veriyi yazar, PENDING olusturur, ayni tx ile audit yazar', async () => {
    const { service, tx, adapter, audit, registry } = kur();
    const normalize = { ad: 'normalize' };
    adapter.validateProposedData.mockResolvedValue(normalize);
    adapter.buildBeforeData.mockResolvedValue({ ad: 'eski' });
    tx.changeRequest.findFirst.mockResolvedValue(null);
    tx.changeRequest.create.mockResolvedValue(talepKur({ id: 'cr-yeni' }));

    const girdi = submitGirdi();
    const sonuc = await service.submit(girdi);

    expect(registry.resolve).toHaveBeenCalledWith('STORE');
    expect(adapter.validateProposedData).toHaveBeenCalledWith(girdi.proposedData, {
      actionType: ChangeRequestAction.UPDATE,
      storeId: MAGAZA,
      businessUnit: null,
    });

    // R — buildBeforeData AYNI tx ile
    expect(adapter.buildBeforeData).toHaveBeenCalledWith(tx, 'entity-1', {
      actionType: ChangeRequestAction.UPDATE,
      storeId: MAGAZA,
      businessUnit: null,
    });

    const yazilan = tx.changeRequest.create.mock.calls[0][0].data;
    expect(yazilan.status).toBe(ChangeRequestStatus.PENDING);
    expect(yazilan.requestedById).toBe(TALEP_SAHIBI);
    // ORIJINAL DEGIL normalize edilmis veri persist edilmeli
    expect(yazilan.proposedData).toBe(normalize);
    expect(yazilan.proposedData).not.toBe(girdi.proposedData);
    expect(yazilan.beforeData).toEqual({ ad: 'eski' });

    // R — audit AYNI tx ile, recordWithTx (record() DEGIL)
    expect(audit.recordWithTx).toHaveBeenCalledTimes(1);
    expect(audit.recordWithTx.mock.calls[0][0]).toBe(tx);
    expect(audit.recordWithTx.mock.calls[0][1].action).toBe('approval.submit');
    expect(sonuc.id).toBe('cr-yeni');
  });

  it('B — D115: ayni hedefte aktif PENDING varsa SUPERSEDED yapar ve supersedesId baglar', async () => {
    const { service, tx, adapter } = kur();
    adapter.validateProposedData.mockResolvedValue({ ad: 'n' });
    adapter.buildBeforeData.mockResolvedValue(null);
    tx.changeRequest.findFirst.mockResolvedValue({ id: 'cr-onceki' });
    tx.changeRequest.create.mockResolvedValue(talepKur());

    await service.submit(submitGirdi());

    // Hedef kimligi YALNIZ entityType + entityId (actionType/storeId dahil degil)
    expect(tx.changeRequest.findFirst).toHaveBeenCalledWith({
      where: {
        entityType: 'STORE',
        entityId: 'entity-1',
        status: ChangeRequestStatus.PENDING,
      },
      select: { id: true },
    });
    expect(tx.changeRequest.update).toHaveBeenCalledWith({
      where: { id: 'cr-onceki' },
      data: { status: ChangeRequestStatus.SUPERSEDED },
    });
    expect(tx.changeRequest.create.mock.calls[0][0].data.supersedesId).toBe('cr-onceki');
  });

  it('C — D121: entityId NULL CREATE bagimsizdir; prior lookup ve supersede YAPILMAZ', async () => {
    const { service, tx, adapter } = kur();
    adapter.validateProposedData.mockResolvedValue({ ad: 'n' });
    adapter.buildBeforeData.mockResolvedValue(null);
    tx.changeRequest.create.mockResolvedValue(talepKur({ entityId: null }));

    await service.submit(
      submitGirdi({ entityId: null, actionType: ChangeRequestAction.CREATE }),
    );

    expect(tx.changeRequest.findFirst).not.toHaveBeenCalled();
    expect(tx.changeRequest.update).not.toHaveBeenCalled();
    expect(tx.changeRequest.create.mock.calls[0][0].data.supersedesId).toBeNull();
    expect(tx.changeRequest.create.mock.calls[0][0].data.status).toBe(
      ChangeRequestStatus.PENDING,
    );
  });

  it('D — D118: P2002 ConflictException olur', async () => {
    const { service, adapter } = kur({ txHatasi: { code: 'P2002' } });
    adapter.validateProposedData.mockResolvedValue({});

    await expect(service.submit(submitGirdi())).rejects.toBeInstanceOf(ConflictException);
  });

  it('D — P2002 DISINDAKI hata oldugu gibi propagate eder', async () => {
    const hata = new Error('baglanti koptu');
    const { service, adapter } = kur({ txHatasi: hata });
    adapter.validateProposedData.mockResolvedValue({});

    await expect(service.submit(submitGirdi())).rejects.toBe(hata);
  });

  it('Q — D117: audit yazimi patlarsa hata propagate eder (yutulmaz)', async () => {
    const { service, tx, adapter, audit } = kur();
    adapter.validateProposedData.mockResolvedValue({});
    adapter.buildBeforeData.mockResolvedValue(null);
    tx.changeRequest.findFirst.mockResolvedValue(null);
    tx.changeRequest.create.mockResolvedValue(talepKur());
    const auditHatasi = new Error('audit yazilamadi');
    audit.recordWithTx.mockRejectedValue(auditHatasi);

    await expect(service.submit(submitGirdi())).rejects.toBe(auditHatasi);
  });
});

// ---------------------------------------------------------------- APPROVE

describe('ApprovalService.approve', () => {
  it('E / TEST-1 — mutlu yol: KOSULLU SAHIPLENME + apply + audit hepsi AYNI tx', async () => {
    const { service, tx, adapter, audit } = kur();
    const talep = talepKur();
    tx.changeRequest.findUnique.mockResolvedValue(talep);
    bagimsizReviewerKur(tx);
    adapter.revalidateCurrentState.mockResolvedValue({ ad: 'eski' });
    tx.changeRequest.findUniqueOrThrow.mockResolvedValue(
      talepKur({ status: ChangeRequestStatus.APPROVED, reviewedById: INCELEYEN }),
    );

    const sonuc = await service.approve({ changeRequestId: 'cr-1', reviewerId: INCELEYEN });

    // C3A-001 — KOSULLU SAHIPLENME: WHERE'de beklenen durum VAR
    const sahiplenme = tx.changeRequest.updateMany.mock.calls[0][0];
    expect(sahiplenme.where).toEqual({
      id: 'cr-1',
      status: ChangeRequestStatus.PENDING,
    });
    expect(sahiplenme.data.status).toBe(ChangeRequestStatus.APPROVED);
    expect(sahiplenme.data.reviewedById).toBe(INCELEYEN);
    expect(sahiplenme.data.reviewedAt).toBeInstanceOf(Date);

    // KOSULSUZ final update ARTIK YOK
    expect(tx.changeRequest.update).not.toHaveBeenCalled();

    // R — hepsi ayni tx nesnesiyle
    expect(adapter.revalidateCurrentState.mock.calls[0][0]).toBe(tx);
    expect(adapter.apply.mock.calls[0][0]).toBe(tx);
    expect(audit.recordWithTx.mock.calls[0][0]).toBe(tx);
    expect(tx.changeRequest.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'cr-1' } });

    expect(adapter.apply).toHaveBeenCalledWith(tx, {
      entityId: 'entity-1',
      actionType: ChangeRequestAction.UPDATE,
      proposedData: talep.proposedData,
      context: { actionType: ChangeRequestAction.UPDATE, storeId: MAGAZA, businessUnit: null },
    });

    expect(audit.recordWithTx.mock.calls[0][1].action).toBe('approval.approve');
    // Public sozlesme korunuyor: ChangeRequest satiri doner
    expect(sonuc.status).toBe(ChangeRequestStatus.APPROVED);
  });

  it('TEST-3 — RUNTIME sira: sahiplenme < apply < audit', async () => {
    const { service, tx, adapter, audit } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur());
    bagimsizReviewerKur(tx);
    adapter.revalidateCurrentState.mockResolvedValue({ ad: 'eski' });

    await service.approve({ changeRequestId: 'cr-1', reviewerId: INCELEYEN });

    expect(cagriSirasi(tx.changeRequest.updateMany)).toBeLessThan(cagriSirasi(adapter.apply));
    expect(cagriSirasi(adapter.apply)).toBeLessThan(cagriSirasi(audit.recordWithTx));
  });

  it('TEST-2 — KAYIP SAHIPLENME (count=0): Conflict; apply ve audit HIC calismaz', async () => {
    const { service, tx, adapter, audit } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur());
    bagimsizReviewerKur(tx);
    adapter.revalidateCurrentState.mockResolvedValue({ ad: 'eski' });
    tx.changeRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.approve({ changeRequestId: 'cr-1', reviewerId: INCELEYEN }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(adapter.apply).not.toHaveBeenCalled();
    expect(audit.recordWithTx).not.toHaveBeenCalled();
    // Ikinci lifecycle yazimi da yok
    expect(tx.changeRequest.update).not.toHaveBeenCalled();
    expect(tx.changeRequest.updateMany).toHaveBeenCalledTimes(1);
  });

  it('TEST-7 — sahiplenme sonrasi apply patlarsa hata propagate eder; audit calismaz', async () => {
    const { service, tx, adapter, audit } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur());
    bagimsizReviewerKur(tx);
    adapter.revalidateCurrentState.mockResolvedValue({ ad: 'eski' });
    const applyHatasi = new Error('domain yazimi patladi');
    adapter.apply.mockRejectedValue(applyHatasi);

    await expect(
      service.approve({ changeRequestId: 'cr-1', reviewerId: INCELEYEN }),
    ).rejects.toBe(applyHatasi);

    expect(audit.recordWithTx).not.toHaveBeenCalled();
  });

  it('F — D116: snapshot bayatsa Conflict; sahiplenme / apply / audit HICBIRI calismaz', async () => {
    const { service, tx, adapter, audit } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur({ beforeData: { ad: 'eski' } }));
    bagimsizReviewerKur(tx);
    adapter.revalidateCurrentState.mockResolvedValue({ ad: 'BASKASI DEGISTIRDI' });

    await expect(
      service.approve({ changeRequestId: 'cr-1', reviewerId: INCELEYEN }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.changeRequest.updateMany).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(tx.changeRequest.update).not.toHaveBeenCalled();
    expect(audit.recordWithTx).not.toHaveBeenCalled();
  });

  it('G — nesne anahtar sirasi yanlis stale URETMEZ', async () => {
    const { service, tx, adapter } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur({ beforeData: { a: 1, b: 2 } }));
    bagimsizReviewerKur(tx);
    adapter.revalidateCurrentState.mockResolvedValue({ b: 2, a: 1 });

    await service.approve({ changeRequestId: 'cr-1', reviewerId: INCELEYEN });

    expect(adapter.apply).toHaveBeenCalledTimes(1);
  });

  it('P — talep yoksa NotFoundException', async () => {
    const { service, tx } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(null);

    await expect(
      service.approve({ changeRequestId: 'yok', reviewerId: INCELEYEN }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ChangeRequestStatus.APPROVED,
    ChangeRequestStatus.REJECTED,
    ChangeRequestStatus.SUPERSEDED,
  ])('O — %s durumundaki talep tekrar onaylanamaz (on-kontrol)', async (durum) => {
    const { service, tx, adapter } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur({ status: durum }));

    await expect(
      service.approve({ changeRequestId: 'cr-1', reviewerId: INCELEYEN }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(tx.changeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('Q / TEST-8 — D117: onay audit yazimi patlarsa hata propagate eder', async () => {
    const { service, tx, adapter, audit } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur());
    bagimsizReviewerKur(tx);
    adapter.revalidateCurrentState.mockResolvedValue({ ad: 'eski' });
    const auditHatasi = new Error('audit yazilamadi');
    audit.recordWithTx.mockRejectedValue(auditHatasi);

    await expect(
      service.approve({ changeRequestId: 'cr-1', reviewerId: INCELEYEN }),
    ).rejects.toBe(auditHatasi);
  });
});

// ---------------------------------------------------------------- BAGIMSIZLIK

describe('ApprovalService — reviewer bagimsizligi (D123/D125)', () => {
  it('H — talep sahibi kendi talebini onaylayamaz; apply calismaz', async () => {
    const { service, tx, adapter } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur({ requestedById: INCELEYEN }));

    await expect(
      service.approve({ changeRequestId: 'cr-1', reviewerId: INCELEYEN }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(tx.changeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('I — magaza sahibi o magazanin talebini onaylayamaz', async () => {
    const { service, tx, adapter } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur());
    tx.store.findUnique.mockResolvedValue({ ownerId: INCELEYEN });
    tx.storeUser.findFirst.mockResolvedValue(null);

    await expect(
      service.approve({ changeRequestId: 'cr-1', reviewerId: INCELEYEN }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it('J — AKTIF magaza personeli onaylayamaz', async () => {
    const { service, tx, adapter } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur());
    tx.store.findUnique.mockResolvedValue({ ownerId: 'baska-sahip' });
    tx.storeUser.findFirst.mockResolvedValue({ id: 'su-1' });

    await expect(
      service.approve({ changeRequestId: 'cr-1', reviewerId: INCELEYEN }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Yalnizca AKTIF uyelik sorgulanir
    expect(tx.storeUser.findFirst).toHaveBeenCalledWith({
      where: { storeId: MAGAZA, userId: INCELEYEN, isActive: true },
      select: { id: true },
    });
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it('K — sahip degil ve aktif uyelik yoksa bagimsiz sayilir', async () => {
    const { service, tx, adapter } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur());
    bagimsizReviewerKur(tx);
    adapter.revalidateCurrentState.mockResolvedValue({ ad: 'eski' });

    await service.approve({ changeRequestId: 'cr-1', reviewerId: INCELEYEN });

    expect(adapter.apply).toHaveBeenCalledTimes(1);
    // R — ownership okumalari da AYNI tx uzerinden
    expect(tx.store.findUnique).toHaveBeenCalledWith({
      where: { id: MAGAZA },
      select: { ownerId: true },
    });
  });

  it('L — storeId NULL ise FAIL-CLOSED (SUPER_ADMIN adi tasisa bile bypass YOK)', async () => {
    const { service, tx, adapter } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur({ storeId: null }));

    await expect(
      service.approve({ changeRequestId: 'cr-1', reviewerId: 'SUPER_ADMIN-kullanici' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.store.findUnique).not.toHaveBeenCalled();
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it('L — magaza kaydi bulunamazsa FAIL-CLOSED', async () => {
    const { service, tx, adapter } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur());
    tx.store.findUnique.mockResolvedValue(null);

    await expect(
      service.approve({ changeRequestId: 'cr-1', reviewerId: INCELEYEN }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(adapter.apply).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- REJECT

describe('ApprovalService.reject', () => {
  it('M / TEST-4 — KOSULLU SAHIPLENME ile REJECTED; audit ayni tx; apply CAGRILMAZ', async () => {
    const { service, tx, adapter, audit, registry } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur());
    bagimsizReviewerKur(tx);
    tx.changeRequest.findUniqueOrThrow.mockResolvedValue(
      talepKur({ status: ChangeRequestStatus.REJECTED, reviewedById: INCELEYEN }),
    );

    const sonuc = await service.reject({
      changeRequestId: 'cr-1',
      reviewerId: INCELEYEN,
      rejectionReason: 'eksik belge',
    });

    const sahiplenme = tx.changeRequest.updateMany.mock.calls[0][0];
    expect(sahiplenme.where).toEqual({
      id: 'cr-1',
      status: ChangeRequestStatus.PENDING,
    });
    expect(sahiplenme.data.status).toBe(ChangeRequestStatus.REJECTED);
    expect(sahiplenme.data.reviewedById).toBe(INCELEYEN);
    expect(sahiplenme.data.reviewedAt).toBeInstanceOf(Date);
    // Semadaki gercek alan adi
    expect(sahiplenme.data.rejectionReason).toBe('eksik belge');
    expect(sahiplenme.data).not.toHaveProperty('reviewNote');

    expect(tx.changeRequest.update).not.toHaveBeenCalled();
    expect(audit.recordWithTx.mock.calls[0][0]).toBe(tx);
    expect(audit.recordWithTx.mock.calls[0][1].action).toBe('approval.reject');
    expect(adapter.apply).not.toHaveBeenCalled();
    expect(registry.resolve).not.toHaveBeenCalled();
    expect(sonuc.status).toBe(ChangeRequestStatus.REJECTED);
  });

  it('TEST-6 — RUNTIME sira: sahiplenme < audit', async () => {
    const { service, tx, audit } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur());
    bagimsizReviewerKur(tx);

    await service.reject({
      changeRequestId: 'cr-1',
      reviewerId: INCELEYEN,
      rejectionReason: 'gerekce',
    });

    expect(cagriSirasi(tx.changeRequest.updateMany)).toBeLessThan(
      cagriSirasi(audit.recordWithTx),
    );
  });

  it('TEST-5 — KAYIP SAHIPLENME (count=0): Conflict; audit HIC calismaz', async () => {
    const { service, tx, audit } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur());
    bagimsizReviewerKur(tx);
    tx.changeRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.reject({
        changeRequestId: 'cr-1',
        reviewerId: INCELEYEN,
        rejectionReason: 'gerekce',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(audit.recordWithTx).not.toHaveBeenCalled();
    expect(tx.changeRequest.update).not.toHaveBeenCalled();
  });

  it('N — reject approve ile AYNI bagimsizlik politikasini uygular (kendi talebi)', async () => {
    const { service, tx } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur({ requestedById: INCELEYEN }));

    await expect(
      service.reject({
        changeRequestId: 'cr-1',
        reviewerId: INCELEYEN,
        rejectionReason: 'gerekce',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.changeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('N — reject: AKTIF personel de reddedemez', async () => {
    const { service, tx } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur());
    tx.store.findUnique.mockResolvedValue({ ownerId: 'baska-sahip' });
    tx.storeUser.findFirst.mockResolvedValue({ id: 'su-1' });

    await expect(
      service.reject({
        changeRequestId: 'cr-1',
        reviewerId: INCELEYEN,
        rejectionReason: 'gerekce',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.changeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('P — talep yoksa NotFoundException', async () => {
    const { service, tx } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(null);

    await expect(
      service.reject({ changeRequestId: 'yok', reviewerId: INCELEYEN, rejectionReason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('O — PENDING olmayan talep reddedilemez (on-kontrol)', async () => {
    const { service, tx } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(
      talepKur({ status: ChangeRequestStatus.APPROVED }),
    );

    await expect(
      service.reject({ changeRequestId: 'cr-1', reviewerId: INCELEYEN, rejectionReason: 'x' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.changeRequest.updateMany).not.toHaveBeenCalled();
  });

  it('Q / TEST-9 — D117: red audit yazimi patlarsa hata propagate eder', async () => {
    const { service, tx, audit } = kur();
    tx.changeRequest.findUnique.mockResolvedValue(talepKur());
    bagimsizReviewerKur(tx);
    const auditHatasi = new Error('audit yazilamadi');
    audit.recordWithTx.mockRejectedValue(auditHatasi);

    await expect(
      service.reject({ changeRequestId: 'cr-1', reviewerId: INCELEYEN, rejectionReason: 'x' }),
    ).rejects.toBe(auditHatasi);
  });
});

// ---------------------------------------------------------------- snapshot helper

describe('snapshotEsit (D116)', () => {
  it('nesne anahtar sirasindan etkilenmez', () => {
    expect(snapshotEsit({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(snapshotEsit({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } })).toBe(true);
  });

  it('dizi SIRASI anlamlidir; siralama yapilmaz', () => {
    expect(snapshotEsit([1, 2], [2, 1])).toBe(false);
    expect(snapshotEsit([1, 2], [1, 2])).toBe(true);
  });

  it('primitive/null semantigini korur', () => {
    expect(snapshotEsit(null, null)).toBe(true);
    expect(snapshotEsit(null, undefined)).toBe(false);
    expect(snapshotEsit(0, '0')).toBe(false);
    expect(snapshotEsit(false, null)).toBe(false);
    expect(snapshotEsit({ a: null }, {})).toBe(false);
    expect(snapshotEsit([], {})).toBe(false);
  });
});
