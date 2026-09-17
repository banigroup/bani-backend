import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';
import { telefonMaskele } from '../../common/pii/telefon-maskele';

// MESAJ ICERIGI HICBIR ORTAMDA LOGLANMAZ: OTP ve teslim kodu bu metnin
// icinde. Yerelde kod zaten devCode ile yanitta donuyor, logda gerekmiyor.
//
// PRODUCTION'DA KAPALI BASARISIZ: SMS_AKTIF "true" olmadiginda moduller bu
// saglayiciya dusuyor. Eskiden bu SESSIZ bir geri dusustu - SMS gitmiyor, yanit
// yine {sent:true} donuyor ve kod loga yaziliyordu. Artik gonderim hata firlatir:
// OTP istegi 5xx olur (Sentry'de gorunur), BildirimService hatayi zaten yakalayip
// HATA durumuyla kaydediyor. Acilista firlatilmadi cunku ayni modul worker
// surecinde de yukleniyor; yanlis bir env worker'in cron'larini durdurmamali.
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SMS');
  async send(phone: string, message: string): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      this.logger.error(`SMS gonderilemedi -> ${telefonMaskele(phone)}: production'da konsol SMS saglayicisi kullanilamaz (SMS_AKTIF=true olmali)`);
      throw new Error('SMS saglayicisi yapilandirilmamis');
    }
    this.logger.warn(`[DEV SMS] -> ${telefonMaskele(phone)}: [icerik gizlendi, ${message.length} karakter]`);
  }
}
