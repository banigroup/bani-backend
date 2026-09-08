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
// ILK GERCEK ADAPTER (D124 Option A): DeliveryZoneAdapter kayitli. Adapter
// kumesi artik bos DEGIL, ama modul HALA hicbir yerden import edilmiyor -
// calisma zamani davranisi yine AKTIF DEGIL.
//
// MarketModule NEDEN IMPORT EDILIYOR: Option A geregi yazma tek kapidan
// (MarketService.teslimatBolgeleriYazTx) gecer; adapter o servisi enjekte eder.
// MarketModule onu export ediyor (market.module.ts:12) ve MarketModule
// ApprovalModule'u import ETMIYOR -> dongusel bagimlilik YOK, forwardRef
// gerekmiyor.
import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { AdapterRegistry, APPROVAL_ADAPTERS } from './adapter/adapter-registry';
import { ApprovalAdapter } from './adapter/approval-adapter.interface';
import { DeliveryZoneAdapter } from './adapter/delivery-zone.adapter';
import { ApprovalService } from './approval.service';

@Module({
  imports: [MarketModule],
  providers: [
    DeliveryZoneAdapter,
    {
      // useValue DEGIL useFactory: adapter artik DI ile kurulan bir sinif
      // (PrismaService + MarketService bagimliliklari var).
      provide: APPROVAL_ADAPTERS,
      useFactory: (deliveryZone: DeliveryZoneAdapter): readonly ApprovalAdapter[] => [
        deliveryZone,
      ],
      inject: [DeliveryZoneAdapter],
    },
    AdapterRegistry,
    ApprovalService,
  ],
  exports: [AdapterRegistry, ApprovalService],
})
export class ApprovalModule {}
