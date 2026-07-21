import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { KuyrukDurum, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BildirimService } from '../bildirim/bildirim.service';

// CEKIRDEK IS KUYRUGU (Faz 1): DB tabanli hafif kuyruk.
// ekle() ile is birakilir; dakikalik worker atomik sahiplenir (cift isleme imkansiz),
// hata olursa artan gecikmeyle tekrar dener, maxDeneme sonunda HATA olarak defterde kalir.
@Injectable()
export class KuyrukService {
  private readonly logger = new Logger(KuyrukService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly bildirim: BildirimService,
  ) {}

  async ekle(tip: string, payload: Prisma.InputJsonValue): Promise<void> {
    try {
      await this.prisma.isKuyrugu.create({ data: { tip, payload } });
    } catch (e) {
      this.logger.error(`Kuyruga eklenemedi: ${tip}`, e as Error);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async isle(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      const is = await this.sahiplen();
      if (!is) return;
      try {
        await this.calistir(is.tip, is.payload as any);
        await this.prisma.isKuyrugu.update({ where: { id: is.id }, data: { durum: KuyrukDurum.TAMAM } });
      } catch (e: any) {
        const deneme = is.denemeSayisi + 1;
        const kalici = deneme >= is.maxDeneme;
        const gecikmeDk = Math.pow(2, deneme); // 2, 4, 8 dk
        await this.prisma.isKuyrugu.update({
          where: { id: is.id },
          data: {
            durum: kalici ? KuyrukDurum.HATA : KuyrukDurum.BEKLIYOR,
            denemeSayisi: deneme,
            sonHata: e?.message ?? String(e),
            calistirZamani: new Date(Date.now() + gecikmeDk * 60 * 1000),
          },
        });
        this.logger.error(`Kuyruk isi basarisiz (${deneme}/${is.maxDeneme})${kalici ? ' - KALICI HATA' : ''}: ${is.tip}: ${e?.message ?? e}`);
      }
    }
  }

  // Atomik sahiplenme: BEKLIYOR + zamani gelmis bir isi ISLENIYOR'a ceker; count 1 degilse baskasi almistir.
  private async sahiplen() {
    const aday = await this.prisma.isKuyrugu.findFirst({
      where: { durum: KuyrukDurum.BEKLIYOR, calistirZamani: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
    });
    if (!aday) return null;
    const kilit = await this.prisma.isKuyrugu.updateMany({
      where: { id: aday.id, durum: KuyrukDurum.BEKLIYOR },
      data: { durum: KuyrukDurum.ISLENIYOR },
    });
    if (kilit.count !== 1) return null;
    return aday;
  }

  private async calistir(tip: string, payload: Record<string, any>): Promise<void> {
    switch (tip) {
      case 'BILDIRIM_SMS':
        await this.bildirim.gonderSms(payload.alici, payload.sablonKodu, payload.degiskenler ?? {});
        return;
      default:
        throw new Error(`Bilinmeyen kuyruk is tipi: ${tip}`);
    }
  }
}