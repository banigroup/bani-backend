import { Module } from '@nestjs/common';
import { HoldingService } from './holding.service';

// Controller YOK — bu modul bilerek yalnizca bir OKUMA SERVISI yayinlar.
//
// Rotalar YERINDE BIRAKILDI: /finance/report/business-units ve
// /superadmin/overview admin panelinden cagriliyor; yeni bir /holding/... uc
// acmak canli paneli kirardi. Controller'lar kendi modullerinde kaldi, govdeleri
// tek satir delegasyona indi - izinler (FINANCE_REPORT_READ / FINANCE_READ) ve
// check-guards.js beklentisi hic degismedi.
//
// PrismaModule global (app.module'de import edilmis), bu yuzden burada ayrica
// provide edilmiyor - superadmin.module.ts'teki ayni desen.
@Module({
  providers: [HoldingService],
  exports: [HoldingService],
})
export class HoldingModule {}
