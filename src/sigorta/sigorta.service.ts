import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SigortaTalepDto } from './dto/sigorta-talep.dto';
@Injectable()
export class SigortaService {
  constructor(private readonly prisma: PrismaService) {}
  async talepOlustur(dto: SigortaTalepDto) {
    const talep = await this.prisma.sigortaTalep.create({
      data: {
        adSoyad: dto.adSoyad.trim(),
        telefon: dto.telefon.trim(),
        sigortaTuru: dto.sigortaTuru,
        kaynak: dto.kaynak ?? 'STANDALONE',
      },
    });
    return { ok: true, id: talep.id };
  }
  async talepleriListele() {
    return this.prisma.sigortaTalep.findMany({ orderBy: { olusturmaTarihi: 'desc' } });
  }
}
