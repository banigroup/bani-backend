import { Module } from '@nestjs/common';
import { LoadService } from './load.service';
import { LoadController } from './load.controller';
import { LoadVitrinController } from './load-vitrin.controller';
import { FinanceModule } from '../finance/finance.module';
import { SozlesmeModule } from '../sozlesme/sozlesme.module';

@Module({
  imports: [FinanceModule, SozlesmeModule],
  controllers: [LoadController, LoadVitrinController],
  providers: [LoadService],
  exports: [LoadService],
})
export class LoadModule { }
