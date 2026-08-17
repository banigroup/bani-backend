import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  PaymentProvider, OdemeBaslatGirdi, OdemeBaslatSonuc, OdemeDogrulaGirdi, OdemeDogrulaSonuc,
} from './payment-provider.interface';

// SANDBOX: gercek saglayici olmadan uctan uca test icin. ConsoleSmsProvider'in
// odeme tarafindaki karsiligi - disari hicbir istek atmaz.
//
// Bekleyen odemeleri BELLEKTE tutar. Bunun iki sonucu var ve ikisi de kabul
// edilebilir: (1) surec yeniden baslarsa yarim kalan odemeler duser - sandbox'ta
// zararsiz, (2) cok instance'li kurulumda initiate ile verify farkli instance'a
// dusebilir. Gercek saglayici state'i kendi tarafinda tuttugu icin bu sinirlama
// yalnizca sandbox'a aittir; kalici tablo acmak sirf test icin fazla olurdu.
@Injectable()
export class SandboxPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger('SANDBOX_PAYMENT');
  private readonly bekleyen = new Map<string, { userId: string; tutarKurus: bigint }>();

  // URETIM KAPISI — SMS tarafindan bilincli sapma.
  // ConsoleSmsProvider uretimde calissa sadece SMS gitmez (zararsiz). Sahte ODEME
  // saglayicisi uretimde calisirsa tahsilat yapilmadan bakiye yazar; yani
  // WALLET_TOPUP'i musteriden almakla kapattigimiz acik, bu ucdan geri acilir.
  // PAYMENT_AKTIF tanimsiz birakildiginda sandbox secildigi icin bu kapi sart.
  private uretimKontrolu() {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException(
        'Sandbox odeme saglayicisi uretimde kullanilamaz - gercek saglayici yapilandirilmali (PAYMENT_AKTIF)',
      );
    }
  }

  async initiate(girdi: OdemeBaslatGirdi): Promise<OdemeBaslatSonuc> {
    this.uretimKontrolu();
    const saglayiciRef = `sandbox-${randomUUID()}`;
    this.bekleyen.set(saglayiciRef, { userId: girdi.userId, tutarKurus: girdi.tutarKurus });
    this.logger.warn(`[SANDBOX] odeme baslatildi ref=${saglayiciRef} tutar=${girdi.tutarKurus} kurus`);
    // Sandbox 3DS yonlendirmesi taklit etmez: dogrudan dogrulamaya hazir doner.
    return { saglayiciRef, durum: 'DOGRULAMAYA_HAZIR' };
  }

  async verify(girdi: OdemeDogrulaGirdi): Promise<OdemeDogrulaSonuc> {
    this.uretimKontrolu();
    const kayit = this.bekleyen.get(girdi.saglayiciRef);
    // Sahiplik kontrolu: ref baskasina aitse bulunamamis gibi davranilir
    // (varligini sizdirmamak icin ayni hata kodu).
    if (kayit && kayit.userId !== girdi.userId) {
      this.logger.warn(`[SANDBOX] ref sahiplik uyusmazligi ref=${girdi.saglayiciRef}`);
      return {
        saglayiciRef: girdi.saglayiciRef,
        basarili: false,
        tahsilEdilenKurus: 0n,
        hataKodu: 'REF_BULUNAMADI',
        hataMesaji: 'Odeme referansi gecersiz ya da daha once kullanilmis',
      };
    }
    if (!kayit) {
      // Bilinmeyen ya da zaten kullanilmis referans: uydurulmus ref ile bakiye
      // yazdirilmasini engelleyen kapi.
      return {
        saglayiciRef: girdi.saglayiciRef,
        basarili: false,
        tahsilEdilenKurus: 0n,
        hataKodu: 'REF_BULUNAMADI',
        hataMesaji: 'Odeme referansi gecersiz ya da daha once kullanilmis',
      };
    }
    // Tek kullanimlik: ayni ref ikinci kez dogrulanamaz.
    this.bekleyen.delete(girdi.saglayiciRef);
    this.logger.warn(`[SANDBOX] odeme dogrulandi ref=${girdi.saglayiciRef} tutar=${kayit.tutarKurus} kurus`);
    return { saglayiciRef: girdi.saglayiciRef, basarili: true, tahsilEdilenKurus: kayit.tutarKurus };
  }
}
