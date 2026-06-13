import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { LedgerService } from './services/ledger.service';
import { WalletService } from './services/wallet.service';

@Module({
  controllers: [FinanceController],
  providers: [FinanceService, LedgerService, WalletService],
  exports: [FinanceService, LedgerService, WalletService],
})
export class FinanceModule {}