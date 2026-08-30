import { Module } from '@nestjs/common';
import { SozlesmeModule } from '../sozlesme/sozlesme.module';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { SellerStatusService } from './seller-status.service';

@Module({
  // Satici sozlesme uclari cekirdek SozlesmeService uzerinden calisir.
  imports: [SozlesmeModule],
  controllers: [MarketController],
  providers: [MarketService, SellerStatusService],
  exports: [MarketService, SellerStatusService],
})
export class MarketModule {}
