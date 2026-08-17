import { Injectable, NotImplementedException } from '@nestjs/common';
import {
  PaymentProvider, OdemeBaslatGirdi, OdemeBaslatSonuc, OdemeDogrulaGirdi, OdemeDogrulaSonuc,
} from './payment-provider.interface';

// IYZICO — ISKELET. Anahtarlar/onay gelmedigi icin govde HENUZ YAZILMADI.
//
// Bilerek NotImplementedException firlatiyor: PAYMENT_AKTIF=true kazara acilirsa
// sistem sessizce yanlis davranmak yerine gurultulu sekilde durur. Sessiz basarisizlik
// burada "para tahsil edilmeden bakiye yazmak" demek olurdu.
//
// Doldurulurken uyulacak iki kural (arayuzun var olus sebebi):
//   1. saglayiciRef iyzico'nun donduugu tekil degerden uretilir (conversationId /
//      paymentId), istemciden gelen hicbir deger ledger reference'i olmaz.
//   2. tahsilEdilenKurus iyzico'nun onayladigi tutardir, istemci beyani degil.
// initiate() 3DS icin threeDSHtmlContent/odeme sayfasi URL'ini YONLENDIR ile doner,
// verify() ise 3DS donusundeki mdStatus/status alanlarini kontrol eder.
@Injectable()
export class IyzicoPaymentProvider implements PaymentProvider {
  async initiate(_girdi: OdemeBaslatGirdi): Promise<OdemeBaslatSonuc> {
    throw new NotImplementedException('iyzico odeme saglayicisi henuz yapilandirilmadi (PAYMENT_AKTIF=false ile sandbox kullanin)');
  }

  async verify(_girdi: OdemeDogrulaGirdi): Promise<OdemeDogrulaSonuc> {
    throw new NotImplementedException('iyzico odeme saglayicisi henuz yapilandirilmadi (PAYMENT_AKTIF=false ile sandbox kullanin)');
  }
}
