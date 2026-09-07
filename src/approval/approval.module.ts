// APPROVAL MODULE (CORE-2 + CORE-3) — bilerek IZOLE: AppModule'a IMPORT EDILMEZ.
// Adapter sozlesmesi + registry (CORE-2) ve lifecycle servisi (CORE-3) burada
// tanimlidir; controller, endpoint ve gercek domain adapter'lari YOKTUR. Modul
// hicbir yerden import edilmedigi icin calisma zamaninda ORNEKLENMEZ - yani
// ApprovalService bugun hicbir HTTP ucundan erisilebilir DEGIL (D122).
//
// PROVIDER KAYDI vs RUNTIME WIRING: servisi kendi modulunun providers'ina yazmak
// repo standardidir (SozlesmeModule, HoldingModule, KuyrukModule, AuditModule -
// hepsi ayni desen). Calisma zamanini aktive eden sey AppModule.imports'tur ve
// oraya BILEREK dokunulmadi.
//
// EK imports GEREKMEZ: PrismaModule ve AuditModule @Global (prisma.module.ts:4,
// audit.module.ts:4); AdapterRegistry zaten bu modulde provide ediliyor.
//
// APPROVAL_ADAPTERS bos dizi ile saglanir: gercek adapter'lar ileriki paketlerde
// tek tek eklenecek. Bos kume derlenebilir ve deterministiktir — registry bos
// haldeyken her cozumleme talebinde yuksek sesle patlar.
import { Module } from '@nestjs/common';
import { AdapterRegistry, APPROVAL_ADAPTERS } from './adapter/adapter-registry';
import { ApprovalAdapter } from './adapter/approval-adapter.interface';
import { ApprovalService } from './approval.service';

const ADAPTERS: readonly ApprovalAdapter[] = [];

@Module({
  providers: [
    { provide: APPROVAL_ADAPTERS, useValue: ADAPTERS },
    AdapterRegistry,
    ApprovalService,
  ],
  exports: [AdapterRegistry, ApprovalService],
})
export class ApprovalModule {}
