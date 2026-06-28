import { Module } from '@nestjs/common';
import { LoadService } from './load.service';
import { LoadController } from './load.controller';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [FinanceModule],
  controllers: [LoadController],
  providers: [LoadService],
  exports: [LoadService],
})
export class LoadModule { }
