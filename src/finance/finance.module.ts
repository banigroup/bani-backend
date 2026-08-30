import { Module } from '@nestjs/common';
import { HoldingModule } from '../holding/holding.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { LedgerService } from './services/ledger.service';
import { WalletService } from './services/wallet.service';
import { PAYMENT_PROVIDER } from './payment/payment-provider.interface';
import { SandboxPaymentProvider } from './payment/sandbox-payment.provider';
import { IyzicoPaymentProvider } from './payment/iyzico-payment.provider';

// SMS_PROVIDER ile ayni secim deseni (bkz. bildirim.module.ts): env bayragi
// hangi implementasyonun baglanacagini belirler. PAYMENT_AKTIF verilmezse
// sandbox devrededir - yani gercek tahsilat yapilmaz.
@Module({
  // FinanceController'daki /report/business-units ucu HoldingService'e delege
  // ediyor (Faz 0 / paket 2) - rota ve izin degismedi, yalnizca govde tasindi.
  imports: [HoldingModule],
  controllers: [FinanceController],
  providers: [
    FinanceService, LedgerService, WalletService,
    { provide: PAYMENT_PROVIDER, useClass: process.env.PAYMENT_AKTIF === 'true' ? IyzicoPaymentProvider : SandboxPaymentProvider },
  ],
  exports: [FinanceService, LedgerService, WalletService],
})
export class FinanceModule {}