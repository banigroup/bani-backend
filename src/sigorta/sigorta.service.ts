import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SigortaTalepDto } from './dto/sigorta-talep.dto';
import { SigortaSubeBasvuruDto } from './dto/sigorta-sube-basvuru.dto';
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

  async subeBasvuruOlustur(dto: SigortaSubeBasvuruDto) {
    const basvuru = await this.prisma.sigortaSubeBasvuru.create({
      data: {
        adSoyad: dto.adSoyad.trim(),
        telefon: dto.telefon.trim(),
        ilBolge: dto.ilBolge?.trim() ?? null,
        sektorTecrube: dto.sektorTecrube ?? false,
        segemSertifika: dto.segemSertifika ?? false,
        aciklama: dto.aciklama?.trim() ?? null,
      },
    });
    return { ok: true, id: basvuru.id };
  }

  async subeBasvurulariListele() {
    return this.prisma.sigortaSubeBasvuru.findMany({ orderBy: { olusturmaTarihi: 'desc' } });
  }
}
