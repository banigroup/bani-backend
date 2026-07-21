import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EvIlaniDurum, EvTeklifDurum, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { EvIlaniOlusturDto } from './dto/ev-ilani-olustur.dto';
import { EvTeklifVerDto } from './dto/ev-teklif-ver.dto';

// EVDEN EVE (tasarim belgesi v1): halka 1 - ilan verme/listeleme + on teklif.
// Kural 4 geregi bu katta hicbir sey baglayici degildir; kesif/kabul sonraki halka.
@Injectable()
export class EvdenEveService {
  constructor(private readonly prisma: PrismaService) {}

  private isAdmin(user: AuthUser): boolean {
    const roles = (user as any)?.roles ?? [];
    return roles.includes(Role.ADMIN) || roles.includes(Role.SUPER_ADMIN);
  }

  // TASITAN: ilan olustur -> ODEME_BEKLIYOR (dusuk pesin ucret, havale + admin onay)
  async ilanOlustur(user: AuthUser, dto: EvIlaniOlusturDto) {
    const alim = new Date(dto.alimTarihi);
    const tBas = new Date(dto.teslimBaslangic);
    const tBit = new Date(dto.teslimBitis);
    if (tBas > tBit) throw new BadRequestException('Teslim penceresi hatali (baslangic > bitis)');
    if (alim > tBas) throw new BadRequestException('Teslim penceresi alim tarihinden once olamaz');
    const simdi = new Date();
    return this.prisma.evIlani.create({
      data: {
        tasitanId: user.id,
        evTipi: dto.evTipi,
        neredenIl: dto.neredenIl.toUpperCase(),
        neredenIlce: dto.neredenIlce ?? null,
        neredenKat: dto.neredenKat ?? null,
        neredenAsansor: dto.neredenAsansor ?? false,
        nereyeIl: dto.nereyeIl.toUpperCase(),
        nereyeIlce: dto.nereyeIlce ?? null,
        nereyeKat: dto.nereyeKat ?? null,
        nereyeAsansor: dto.nereyeAsansor ?? false,
        alimTarihi: alim,
        teslimBaslangic: tBas,
        teslimBitis: tBit,
        fotograflar: dto.fotograflar.map((url) => ({ url, yuklemeZamani: simdi.toISOString() })),
        aciklama: dto.aciklama ?? null,
        sigortaTalebi: dto.sigortaTalebi ?? false,
      },
    });
  }

  // TASITAN: kendi ilanlarim (teklifleriyle)
  async ilanlarim(user: AuthUser) {
    return this.prisma.evIlani.findMany({
      where: { tasitanId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // TASIYAN: borsa - ACIK ilanlar
  async borsa() {
    return this.prisma.evIlani.findMany({
      where: { durum: EvIlaniDurum.ACIK },
      orderBy: { alimTarihi: 'asc' },
    });
  }

  // ADMIN: ucret onayi bekleyen ilanlar
  async bekleyenIlanlar(user: AuthUser) {
    if (!this.isAdmin(user)) throw new ForbiddenException('Bu islem icin yetkiniz yok');
    return this.prisma.evIlani.findMany({
      where: { durum: EvIlaniDurum.ODEME_BEKLIYOR },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ADMIN: ilan ucreti havale onayi -> ACIK (atomik)
  async ucretOnayla(user: AuthUser, ilanId: string) {
    if (!this.isAdmin(user)) throw new ForbiddenException('Bu islem icin yetkiniz yok');
    const kilit = await this.prisma.evIlani.updateMany({
      where: { id: ilanId, durum: EvIlaniDurum.ODEME_BEKLIYOR },
      data: { durum: EvIlaniDurum.ACIK, ucretOnayZamani: new Date() },
    });
    if (kilit.count !== 1) throw new ConflictException('Ilan onaylanamadi (bulunamadi ya da zaten islenmis)');
    return this.prisma.evIlani.findUnique({ where: { id: ilanId } });
  }

  // TASIYAN: on teklif ver (baglayici degil - Kural 4)
  async onTeklifVer(user: AuthUser, dto: EvTeklifVerDto) {
    const ilan = await this.prisma.evIlani.findUnique({ where: { id: dto.evIlaniId } });
    if (!ilan) throw new NotFoundException('Ilan bulunamadi');
    if (ilan.tasitanId === user.id) throw new ForbiddenException('Kendi ilaniniza teklif veremezsiniz');
    if (ilan.durum !== EvIlaniDurum.ACIK) throw new ConflictException('Bu ilan teklif almiyor');
    const mevcut = await this.prisma.evTeklif.findFirst({
      where: { evIlaniId: ilan.id, tasiyanId: user.id, durum: { in: [EvTeklifDurum.ON_TEKLIF, EvTeklifDurum.KESFE_DAVET, EvTeklifDurum.KESIF_UYGUN, EvTeklifDurum.KESIF_REVIZE] } },
    });
    if (mevcut) throw new ConflictException('Bu ilanda aktif bir teklifiniz zaten var');
    return this.prisma.evTeklif.create({
      data: { evIlaniId: ilan.id, tasiyanId: user.id, onTeklifKurus: BigInt(dto.onTeklifKurus) },
    });
  }

  // Ilan detay: sahibi/admin tekliflerle gorur; digerleri ACIK ise ilani gorur
  async ilanDetay(user: AuthUser, ilanId: string) {
    const ilan = await this.prisma.evIlani.findUnique({ where: { id: ilanId } });
    if (!ilan) throw new NotFoundException('Ilan bulunamadi');
    const sahibiMi = ilan.tasitanId === user.id;
    if (sahibiMi || this.isAdmin(user)) {
      const teklifler = await this.prisma.evTeklif.findMany({ where: { evIlaniId: ilan.id }, orderBy: { createdAt: 'asc' } });
      return { ...ilan, teklifler };
    }
    if (ilan.durum !== EvIlaniDurum.ACIK) throw new ForbiddenException('Bu ilana erisiminiz yok');
    const kendiTeklifim = await this.prisma.evTeklif.findFirst({ where: { evIlaniId: ilan.id, tasiyanId: user.id } });
    return { ...ilan, kendiTeklifim };
  }
}