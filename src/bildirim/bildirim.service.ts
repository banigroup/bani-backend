import { Inject, Injectable, Logger } from '@nestjs/common';
import { BildirimDurum, BildirimKanal } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SMS_PROVIDER, SmsProvider } from './sms/sms-provider.interface';

// CEKIRDEK BILDIRIM SERVISI (Faz 1): tek kapi, sablonlu, kanal-bagimsiz.
// Sablonlar simdilik kodda; sayi buyuyunce DB'ye tasinir.
const SABLONLAR: Record<string, string> = {
  TEKLIF_GELDI: 'BaniLoad: {ilan} ilaniniza yeni teklif geldi.',
  TEKLIF_KABUL: 'BaniLoad: {ilan} icin teklifiniz kabul edildi.',
  TESLIM_ONAY: 'BaniLoad: {ilan} teslimati onaylandi.',
  BELGE_ONAY: 'BaniLoad: {belge} belgeniz onaylandi.',
  BELGE_RED: 'BaniLoad: {belge} belgeniz reddedildi. Gerekce: {gerekce}',
  KOMISYON_ONAY: 'BaniLoad: komisyon odemeniz onaylandi.',
};

@Injectable()
export class BildirimService {
  private readonly logger = new Logger(BildirimService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private doldur(sablon: string, degiskenler: Record<string, string>): string {
    let m = sablon;
    for (const [k, v] of Object.entries(degiskenler ?? {})) m = m.split(`{${k}}`).join(v);
    return m;
  }

  // Tek kapi: hata yutar (bildirim, ana islemi asla bozmaz), her denemeyi kayda gecer.
  async gonderSms(alici: string, sablonKodu: string, degiskenler: Record<string, string> = {}): Promise<void> {
    const sablon = SABLONLAR[sablonKodu];
    if (!sablon) { this.logger.error(`Bilinmeyen sablon: ${sablonKodu}`); return; }
    const icerik = this.doldur(sablon, degiskenler);
    let durum: BildirimDurum = BildirimDurum.GONDERILDI;
    let hataMesaji: string | null = null;
    try {
      await this.sms.send(alici, icerik);
    } catch (e: any) {
      durum = BildirimDurum.HATA;
      hataMesaji = e?.message ?? String(e);
      this.logger.error(`Bildirim gonderilemedi: ${sablonKodu} -> ${alici}: ${hataMesaji}`);
    }
    try {
      await this.prisma.bildirimKayit.create({
        data: { kanal: BildirimKanal.SMS, alici, sablonKodu, icerik, durum, hataMesaji },
      });
    } catch (e) {
      this.logger.error(`Bildirim kaydi yazilamadi: ${sablonKodu}`, e as Error);
    }
  }
}