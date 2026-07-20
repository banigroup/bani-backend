import { Module } from '@nestjs/common';
import { LoadService } from './load.service';
import { LoadController } from './load.controller';
import { LoadVitrinController } from './load-vitrin.controller';
import { FinanceModule } from '../finance/finance.module';
import { SozlesmeModule } from '../sozlesme/sozlesme.module';
import { BildirimModule } from '../bildirim/bildirim.module';

@Module({
  imports: [FinanceModule, SozlesmeModule, BildirimModule],
  controllers: [LoadController, LoadVitrinController],
  providers: [LoadService],
  exports: [LoadService],
})
export class LoadModule { }
