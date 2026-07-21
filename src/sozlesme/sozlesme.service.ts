import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SozlesmeTipi } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// CEKIRDEK SOZLESME SERVISI (Faz 1): gecerli surum DB'den (sozlesme_versiyonlari) okunur.
// Yeni surum yayinlamak = yeni satir + aktif bayragi; kod deploy'u gerekmez.
@Injectable()
export class SozlesmeService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly TIP_ADI: Record<SozlesmeTipi, string> = {
    [SozlesmeTipi.TASIYICI]: 'Taşıyıcı',
    [SozlesmeTipi.YUK_VEREN]: 'Yük Veren',
    [SozlesmeTipi.EVDEN_EVE_TASIYAN]: 'Evden Eve Taşıyan',
    [SozlesmeTipi.EVDEN_EVE_TASITAN]: 'Evden Eve Taşıtan',
  };

  private async aktifVersiyon(tip: SozlesmeTipi) {
    const v = await this.prisma.sozlesmeVersiyon.findFirst({
      where: { tip, aktif: true },
      orderBy: { yururlukTarihi: 'desc' },
    });
    if (!v) throw new ServiceUnavailableException('Bu sozlesme tipi icin aktif surum tanimli degil');
    return v;
  }

  async onayliMi(userId: string, tip: SozlesmeTipi): Promise<boolean> {
    const v = await this.aktifVersiyon(tip);
    const onay = await this.prisma.sozlesmeOnay.findUnique({
      where: { kullaniciId_sozlesmeTipi_surum: { kullaniciId: userId, sozlesmeTipi: tip, surum: v.surum } },
    });
    return !!onay;
  }

  async durum(userId: string, tip: SozlesmeTipi) {
    const v = await this.aktifVersiyon(tip);
    const onayli = await this.onayliMi(userId, tip);
    return { sozlesmeTipi: tip, gecerliSurum: v.surum, onayli };
  }

  async onayla(userId: string, tip: SozlesmeTipi, ip?: string, cihaz?: string) {
    const v = await this.aktifVersiyon(tip);
    const mevcut = await this.prisma.sozlesmeOnay.findUnique({
      where: { kullaniciId_sozlesmeTipi_surum: { kullaniciId: userId, sozlesmeTipi: tip, surum: v.surum } },
    });
    if (mevcut) return mevcut; // idempotent
    return this.prisma.sozlesmeOnay.create({
      data: { kullaniciId: userId, sozlesmeTipi: tip, surum: v.surum, metinHash: v.metinHash, ip: ip ?? null, cihaz: cihaz ?? null },
    });
  }

  async kontrol(userId: string, tip: SozlesmeTipi) {
    const onayli = await this.onayliMi(userId, tip);
    if (!onayli) {
      const ad = this.TIP_ADI[tip] ?? tip;
      throw new ForbiddenException(`Devam edebilmek için ${ad} Üyelik Sözleşmesi'ni onaylamanız gerekir.`);
    }
  }
}