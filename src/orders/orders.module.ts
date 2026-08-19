import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrderStatusService } from './order-status.service';
import { OrdersController } from './orders.controller';
import { FinanceModule } from '../finance/finance.module';
import { BildirimModule } from '../bildirim/bildirim.module';

@Module({
  // BildirimModule: checkout'ta uretilen teslim kodunun IKINCIL kanali (SMS).
  imports: [FinanceModule, BildirimModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderStatusService],
  // OrderStatusService export ediliyor: DeliveryModule bu servisi kullanarak
  // sipariş durumunu geçiriyor (Prisma ile doğrudan yazma yerine).
  exports: [OrdersService, OrderStatusService],
})
export class OrdersModule {}
