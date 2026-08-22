import { Injectable, NotFoundException } from '@nestjs/common';
import { SigortaDurum, SigortaKaynak, SigortaTuru, SubeBasvuruDurum } from '@prisma/client';
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
  // BANILOAD LEAD'I — is kuyrugu ('SIGORTA_LEAD_OLUSTUR') uzerinden cagrilir.
  // Dikeyler arasi dogrudan cagri YOK: load bu metodu tanimaz, yalnizca kuyruga
  // is birakir; tuketen taraf burasidir (holding ilkesi).
  //
  // HATA YUTULMAZ (eski load/evdeneve.sigortaLeadYaz'dan farki): hata kuyruga
  // firlar, KuyrukService 2/4/8 dk gecikmeyle 3 kez dener ve basaramazsa isi
  // HATA durumunda defterde birakir. Yutulsaydi kuyruk isi TAMAM sanardi.
  //
  // 24 SAAT DEDUPE burada, cagiranda degil: talepOlustur idempotent degil ve
  // is artik tekrar denenebiliyor - kontrol yazma anina en yakin yerde durmali.
  async leadOlustur(tasitanId: string) {
    const sahip = await this.prisma.user.findUnique({
      where: { id: tasitanId },
      select: { name: true, surname: true, phone: true },
    });
    if (!sahip?.phone) return;
    const yirmiDortSaatOnce = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const mevcut = await this.prisma.sigortaTalep.findFirst({
      where: {
        telefon: sahip.phone,
        kaynak: SigortaKaynak.BANILOAD,
        durum: SigortaDurum.YENI,
        deletedAt: null,
        olusturmaTarihi: { gte: yirmiDortSaatOnce },
      },
    });
    if (mevcut) return;
    // name/surname NULLABLE - bos kalirsa sigorta ekibi kimi arayacagini bilsin diye telefon yaziyoruz
    const adSoyad = `${sahip.name ?? ''} ${sahip.surname ?? ''}`.trim() || sahip.phone;
    await this.talepOlustur({
      adSoyad,
      telefon: sahip.phone,
      sigortaTuru: SigortaTuru.NAKLIYAT,
      kaynak: SigortaKaynak.BANILOAD,
    });
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
