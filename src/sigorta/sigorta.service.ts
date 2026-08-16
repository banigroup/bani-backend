import { Injectable, NotFoundException } from '@nestjs/common';
import { SigortaDurum, SubeBasvuruDurum } from '@prisma/client';
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

  // Admin: talep durumu (YENI -> ARANDI -> TAMAMLANDI). Silinmis kayit guncellenmez.
  async talepDurumGuncelle(id: string, durum: SigortaDurum, adminNot?: string) {
    const kayit = await this.prisma.sigortaTalep.findUnique({ where: { id } });
    if (!kayit || kayit.deletedAt) throw new NotFoundException('Sigorta talebi bulunamadi');
    return this.prisma.sigortaTalep.update({
      where: { id },
      data: { durum, ...(adminNot !== undefined ? { adminNot } : {}) },
    });
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

  // Admin: sube basvurusu durumu (YENI -> ARANDI -> TAMAMLANDI). Silinmis kayit guncellenmez.
  async subeBasvuruDurumGuncelle(id: string, durum: SubeBasvuruDurum, adminNot?: string) {
    const kayit = await this.prisma.sigortaSubeBasvuru.findUnique({ where: { id } });
    if (!kayit || kayit.deletedAt) throw new NotFoundException('Sube basvurusu bulunamadi');
    return this.prisma.sigortaSubeBasvuru.update({
      where: { id },
      data: { durum, ...(adminNot !== undefined ? { adminNot } : {}) },
    });
  }
}
