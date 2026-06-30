import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PartnerBasvuruTip, PartnerBasvuruDurum, BusinessUnit, Prisma } from "@prisma/client";
import { CreateBasvuruDto } from "./dto/create-basvuru.dto";

@Injectable()
export class PartnerService {
  constructor(private readonly prisma: PrismaService) {}

  // Yeni basvuru olustur (tip disaridan, kanit ip/cihaz opsiyonel)
  async basvuruOlustur(
    tip: PartnerBasvuruTip,
    dto: CreateBasvuruDto,
    ip?: string,
    cihaz?: string,
  ) {
    const data: Prisma.PartnerBasvuruCreateInput = {
      tip,
      adSoyad: dto.adSoyad,
      telefon: dto.telefon,
      il: dto.il ?? null,
      isletme: dto.isletme ?? null,
      restoran: dto.restoran ?? null,
      butce: dto.butce ?? null,
      aracTipi: dto.aracTipi ?? null,
      ip: ip ?? null,
      cihaz: cihaz ?? null,
    };
    // SELLER basvurusu CARSI businessUnit ile etiketlenir
    if (tip === PartnerBasvuruTip.SELLER) {
      data.businessUnit = BusinessUnit.CARSI;
    }
    const kayit = await this.prisma.partnerBasvuru.create({ data });
    return { ok: true, id: kayit.id, mesaj: "Basvurunuz alindi. En kisa surede donus yapilacaktir." };
  }

  // Admin: tum basvurulari listele (tip/durum filtreli)
  async listele(tip?: PartnerBasvuruTip, durum?: PartnerBasvuruDurum) {
    return this.prisma.partnerBasvuru.findMany({
      where: { ...(tip ? { tip } : {}), ...(durum ? { durum } : {}) },
      orderBy: { createdAt: "desc" },
    });
  }

  // Admin: durum guncelle
  async durumGuncelle(id: string, durum: PartnerBasvuruDurum, not?: string) {
    return this.prisma.partnerBasvuru.update({
      where: { id },
      data: { durum, ...(not !== undefined ? { not } : {}) },
    });
  }
}
