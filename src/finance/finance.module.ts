import { Module } from '@nestjs/common';
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
  controllers: [FinanceController],
  providers: [
    FinanceService, LedgerService, WalletService,
    { provide: PAYMENT_PROVIDER, useClass: process.env.PAYMENT_AKTIF === 'true' ? IyzicoPaymentProvider : SandboxPaymentProvider },
  ],
  exports: [FinanceService, LedgerService, WalletService],
})
export class FinanceModule {}