// APPROVAL ADAPTER REGISTRY (CORE-2) — tek isi: entityType -> ApprovalAdapter.
//
// Registry HICBIR SEY BILMEZ: RBAC, ownership, AuditLog, ChangeRequest yasam
// dongusu, D118 tekillik kisiti, stale karsilastirmasi, action semantigi. Bunlarin
// hicbiri buraya sizmamalidir — burasi yalnizca bir cozumleme tablosudur.
//
// FAIL LOUD: eksik adapter da, cakisan adapter de sessizce gecistirilmez.
//   - Cakisma bootstrap aninda patlar (yanlis wiring canliya cikmasin).
//   - Eksik adapter cozumleme aninda patlar.
// Varsayilan/fallback adapter YOKTUR: bilinmeyen bir entityType'in "bir sekilde"
// islenmesi, onay kapisini sessizce delen en tehlikeli davranis olurdu.
//
// Global mutable singleton YOK: adapter kumesi DI ile (APPROVAL_ADAPTERS token'i)
// verilir ve construct aninda degismez bir Map'e kopyalanir.
import { Inject, Injectable } from '@nestjs/common';
import { ApprovalAdapter } from './approval-adapter.interface';

// SMS_PROVIDER / PAYMENT_PROVIDER ile ayni Symbol token deseni.
export const APPROVAL_ADAPTERS = Symbol('APPROVAL_ADAPTERS');

@Injectable()
export class AdapterRegistry {
  private readonly adapters: ReadonlyMap<string, ApprovalAdapter>;

  constructor(@Inject(APPROVAL_ADAPTERS) adapters: readonly ApprovalAdapter[]) {
    const harita = new Map<string, ApprovalAdapter>();
    for (const adapter of adapters) {
      if (harita.has(adapter.entityType)) {
        throw new Error(
          `Approval adapter cakismasi: '${adapter.entityType}' icin birden fazla adapter kayitli.`,
        );
      }
      harita.set(adapter.entityType, adapter);
    }
    this.adapters = harita;
  }

  // Tam eslesme; normalizasyon/buyuk-kucuk harf toleransi YOK.
  resolve(entityType: string): ApprovalAdapter {
    const adapter = this.adapters.get(entityType);
    if (!adapter) {
      // Kullanici hatasi degil, wiring hatasi — bu yuzden HTTP istisnasi degil,
      // duz Error. Registry HTTP katmanini bilmez.
      throw new Error(`Approval adapter bulunamadi: '${entityType}'.`);
    }
    return adapter;
  }
}
