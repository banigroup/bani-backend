import { Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { DeliveryController } from './delivery.controller';
import { TakipController } from './takip.controller';
import { FinanceModule } from '../finance/finance.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  // OrdersModule: sipariş durum geçişleri için OrderStatusService buradan gelir.
  imports: [FinanceModule, OrdersModule],
  controllers: [DeliveryController, TakipController],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule { }
