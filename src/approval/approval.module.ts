// APPROVAL MODULE (CORE-2) — bilerek IZOLE: AppModule'a IMPORT EDILMEZ.
// Bu turda yalnizca adapter sozlesmesi + registry wiring'i vardir; controller,
// endpoint, ApprovalService ve gercek domain adapter'lari YOKTUR. Yani modul
// suan hicbir calisma zamani davranisi aktive etmez.
//
// APPROVAL_ADAPTERS bos dizi ile saglanir: gercek adapter'lar ileriki paketlerde
// tek tek eklenecek. Bos kume derlenebilir ve deterministiktir — registry bos
// haldeyken her cozumleme talebinde yuksek sesle patlar.
import { Module } from '@nestjs/common';
import { AdapterRegistry, APPROVAL_ADAPTERS } from './adapter/adapter-registry';
import { ApprovalAdapter } from './adapter/approval-adapter.interface';

const ADAPTERS: readonly ApprovalAdapter[] = [];

@Module({
  providers: [
    { provide: APPROVAL_ADAPTERS, useValue: ADAPTERS },
    AdapterRegistry,
  ],
  exports: [AdapterRegistry],
})
export class ApprovalModule {}
