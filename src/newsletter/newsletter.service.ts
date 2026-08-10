import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubscribeDto } from './dto/subscribe.dto';

@Injectable()
export class NewsletterService {
  constructor(private readonly prisma: PrismaService) {}

  // Mukerrer kayit HATA DEGILDIR: ayni e-posta tekrar abone olursa
  // sessizce mevcut kayit doner (controller 200 ile cevaplar).
  async subscribe(dto: SubscribeDto) {
    const eposta = dto.eposta.trim().toLowerCase();
    const businessUnit = (dto.businessUnit || 'GENEL').trim().toUpperCase();

    const mevcut = await this.prisma.newsletterSubscriber.findUnique({
      where: { eposta_businessUnit: { eposta, businessUnit } },
    });
    if (mevcut) return { kayitli: true, yeni: false };

    await this.prisma.newsletterSubscriber.create({
      data: { eposta, businessUnit },
    });
    return { kayitli: true, yeni: true };
  }
}
