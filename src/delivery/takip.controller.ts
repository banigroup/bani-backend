import { Controller, Get, Param } from '@nestjs/common';
import { DeliveryService } from './delivery.service';

// PUBLIC — JwtAuthGuard YOK. DicleFul kargo takip sayfası bunu çağırır.
// Müşteri GİRİŞ YAPMADAN takip no ile gönderisini sorgular.
// Servis tarafı yalnızca lojistik durum döndürür (sipariş/ürün/kişi bilgisi YOK).
@Controller('takip')
export class TakipController {
  constructor(private readonly delivery: DeliveryService) { }

  @Get(':takipNo')
  takip(@Param('takipNo') takipNo: string) {
    return this.delivery.takip(takipNo);
  }
}
