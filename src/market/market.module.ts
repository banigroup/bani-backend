import { Module } from '@nestjs/common';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { SellerStatusService } from './seller-status.service';

@Module({
  controllers: [MarketController],
  providers: [MarketService, SellerStatusService],
  exports: [MarketService, SellerStatusService],
})
export class MarketModule {}
