// APPROVAL ADAPTER SOZLESMESI (CORE-2) — SMS_PROVIDER / PAYMENT_PROVIDER ile ayni
// desen: dar arayuz + Symbol DI token (token adapter-registry.ts'te).
//
// ADAPTER NE YAPAR:
//   1. Onerilen veriyi kendi domain kurallariyla dogrular/normalize eder.
//   2. Approval icin ANLAMLI kanonik snapshot uretir (before + guncel).
//   3. Onaylanan degisikligi DISARIDAN VERILEN transaction icinde uygular.
//
// ADAPTER NE YAPMAZ (bilerek disarida):
//   - stale/conflict kararini VERMEZ. Core, beforeData ile revalidateCurrentState
//     sonucunu karsilastirip karari kendisi verir; adapter yalnizca iki snapshot'i
//     uretir. Boylece "hangi degisiklik catisir" politikasi tek yerde kalir.
//   - ChangeRequest yasam dongusune (submit/approve/reject/supersede) dokunmaz.
//   - AuditLog YAZMAZ (D117 izi Core'un transaction'inda AuditService.recordWithTx
//     ile yazilir; cift kayit yasagi).
//   - RBAC / izin kontrolu YAPMAZ.
//   - ownership/self-approval cozmez — resolveOwnershipScope BILEREK YOK, o D112
//     kapsaminda ayri bir policy/resolver isidir.
//   - KENDI $transaction'ini ACMAZ, root Prisma KULLANMAZ. Snapshot ve apply
//     metodlarinin tamami disaridan gelen tx uzerinden calisir; aksi halde
//     "is + iz birlikte ya da hic" garantisi kirilirdi.
import { BusinessUnit, ChangeRequestAction, Prisma } from '@prisma/client';

// Adapter'in gorebilecegi BAGLAM — bilerek DAR tutuldu.
// requesterId/reviewerId/rol/izin/ownership/IP/correlationId/ChangeRequest id ve
// status BURAYA GIRMEZ: bunlarin adapter'a sizmasi, yukarida disarida birakilan
// sorumluluklarin (RBAC, ownership, lifecycle) adapter icine kacmasinin en kolay
// yoludur.
export interface ApprovalAdapterContext {
  actionType: ChangeRequestAction;
  storeId?: string | null;
  businessUnit?: BusinessUnit | null;
}

export interface ApprovalApplyInput {
  // CREATE'te null (ChangeRequest.entityId ile ayni sekil). Bu nullable'lik
  // CREATE_SUPERSEDE_IDENTITY kararini COZMEZ — o konu hala acik.
  entityId: string | null;
  actionType: ChangeRequestAction;
  // v1'de bilerek unknown: adapter kendi domain'inde dogrulayip daraltir.
  // Generic tip parametresi veya Record<string, unknown> yer tutucusu YOK.
  proposedData: unknown;
  context: ApprovalAdapterContext;
}

export interface ApprovalAdapter {
  // Registry'nin cozumleme anahtari. ChangeRequest.entityType ile BIREBIR eslesir.
  readonly entityType: string;

  validateProposedData(
    proposedData: unknown,
    context: ApprovalAdapterContext,
  ): Promise<unknown>;

  // Talep anindaki kanonik snapshot (ChangeRequest.beforeData).
  buildBeforeData(
    tx: Prisma.TransactionClient,
    entityId: string | null,
    context: ApprovalAdapterContext,
  ): Promise<unknown>;

  // Onay anindaki GUNCEL kanonik snapshot. buildBeforeData ile AYNI sekli
  // uretmelidir; yoksa Core'un karsilastirmasi anlamsizlasir. (Somut adapter'da
  // ikisinin ortak bir private snapshot helper'ini kullanmasi beklenen desendir.)
  revalidateCurrentState(
    tx: Prisma.TransactionClient,
    entityId: string | null,
    context: ApprovalAdapterContext,
  ): Promise<unknown>;

  apply(
    tx: Prisma.TransactionClient,
    input: ApprovalApplyInput,
  ): Promise<void>;
}
