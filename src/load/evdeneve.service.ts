import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EvIlaniDurum, EvTeklifDurum, Role, SozlesmeTipi } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { KuyrukService } from '../kuyruk/kuyruk.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { EvIlaniOlusturDto } from './dto/ev-ilani-olustur.dto';
import { EvTeklifVerDto } from './dto/ev-teklif-ver.dto';

// EVDEN EVE (tasarim belgesi v1): halka 1 - ilan verme/listeleme + on teklif.
// Kural 4 geregi bu katta hicbir sey baglayici degildir; kesif/kabul sonraki halka.
@Injectable()
export class EvdenEveService {
  constructor(private readonly prisma: PrismaService, private readonly sozlesme: SozlesmeService, private readonly kuyruk: KuyrukService) {}

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

  // TASITAN: bir on teklifi kesfe davet et (Kural 4 - kesif randevusu dogar, is KILITLENMEZ)
  async kesfeDavet(user: AuthUser, teklifId: string, kesifRandevu: string) {
    const teklif = await this.prisma.evTeklif.findUnique({ where: { id: teklifId } });
    if (!teklif) throw new NotFoundException('Teklif bulunamadi');
    const ilan = await this.prisma.evIlani.findUnique({ where: { id: teklif.evIlaniId } });
    if (!ilan) throw new NotFoundException('Ilan bulunamadi');
    if (ilan.tasitanId !== user.id) throw new ForbiddenException('Bu ilan size ait degil');
    if (teklif.durum !== EvTeklifDurum.ON_TEKLIF) throw new ConflictException('Bu teklif kesfe davet edilemez');
    const randevu = new Date(kesifRandevu);
    if (isNaN(randevu.getTime()) || randevu < new Date()) throw new BadRequestException('Kesif randevusu gecersiz ya da gecmiste');
    return this.prisma.$transaction(async (tx) => {
      // Atomik: ilan sadece ACIK iken KESIF_SURECINDE'ye gecer (ayni anda ikinci davet imkansiz)
      const iKilit = await tx.evIlani.updateMany({
        where: { id: ilan.id, durum: EvIlaniDurum.ACIK },
        data: { durum: EvIlaniDurum.KESIF_SURECINDE, seciliTeklifId: teklif.id },
      });
      if (iKilit.count !== 1) throw new ConflictException('Ilan su an kesfe davet icin uygun degil');
      const tKilit = await tx.evTeklif.updateMany({
        where: { id: teklif.id, durum: EvTeklifDurum.ON_TEKLIF },
        data: { durum: EvTeklifDurum.KESFE_DAVET, kesifRandevu: randevu },
      });
      if (tKilit.count !== 1) throw new ConflictException('Teklif su an kesfe davet edilemez');
      return tx.evTeklif.findUnique({ where: { id: teklif.id } });
    });
  }

  // TASIYAN: kesif sonucunu gir (evi gordum - beyan uygun ya da revize kesin fiyat)
  async kesifSonuc(user: AuthUser, dto: { teklifId: string; beyanUygun: boolean; kesinFiyatKurus?: number; kesifFotograflar: string[]; kesifNotu?: string }) {
    const teklif = await this.prisma.evTeklif.findUnique({ where: { id: dto.teklifId } });
    if (!teklif) throw new NotFoundException('Teklif bulunamadi');
    if (teklif.tasiyanId !== user.id) throw new ForbiddenException('Bu teklif size ait degil');
    if (teklif.durum !== EvTeklifDurum.KESFE_DAVET) throw new ConflictException('Bu teklif kesif sonucu girmeye uygun degil');
    if (!dto.beyanUygun && !dto.kesinFiyatKurus) throw new BadRequestException('Revize icin kesin fiyat zorunlu');
    const simdi = new Date();
    const kesinFiyat = dto.beyanUygun ? teklif.onTeklifKurus : BigInt(dto.kesinFiyatKurus!);
    const kilit = await this.prisma.evTeklif.updateMany({
      where: { id: teklif.id, durum: EvTeklifDurum.KESFE_DAVET },
      data: {
        durum: dto.beyanUygun ? EvTeklifDurum.KESIF_UYGUN : EvTeklifDurum.KESIF_REVIZE,
        kesifZamani: simdi,
        kesinFiyatKurus: kesinFiyat,
        kesifFotograflar: dto.kesifFotograflar.map((url) => ({ url, cekimZamani: simdi.toISOString() })),
        kesifNotu: dto.kesifNotu ?? null,
      },
    });
    if (kilit.count !== 1) throw new ConflictException('Kesif sonucu kaydedilemedi (durum degismis)');
    return this.prisma.evTeklif.findUnique({ where: { id: teklif.id } });
  }
  // TASITAN: kesin fiyati kabul et = KILIT ANI (Kural 4'un sonu, Kural 5'in dogumu)
  // Atomik: ilan KILITLENDI + teklif KABUL + digerleri RED + IKI SOZLESME AYNI ANDA
  async kesinFiyatKabul(user: AuthUser, teklifId: string, ip?: string) {
    const teklif = await this.prisma.evTeklif.findUnique({ where: { id: teklifId } });
    if (!teklif) throw new NotFoundException('Teklif bulunamadi');
    const ilan = await this.prisma.evIlani.findUnique({ where: { id: teklif.evIlaniId } });
    if (!ilan) throw new NotFoundException('Ilan bulunamadi');
    if (ilan.tasitanId !== user.id) throw new ForbiddenException('Bu ilan size ait degil');
    if (teklif.durum !== EvTeklifDurum.KESIF_UYGUN && teklif.durum !== EvTeklifDurum.KESIF_REVIZE) {
      throw new ConflictException('Kabul icin once kesif sonucu girilmis olmali');
    }
    if (!teklif.kesinFiyatKurus) throw new ConflictException('Kesin fiyat bulunamadi');
    const sonuc = await this.prisma.$transaction(async (tx) => {
      const iKilit = await tx.evIlani.updateMany({
        where: { id: ilan.id, durum: EvIlaniDurum.KESIF_SURECINDE, seciliTeklifId: teklif.id },
        data: { durum: EvIlaniDurum.KILITLENDI },
      });
      if (iKilit.count !== 1) throw new ConflictException('Ilan kilitlenemedi (durum degismis)');
      const tKilit = await tx.evTeklif.updateMany({
        where: { id: teklif.id, durum: { in: [EvTeklifDurum.KESIF_UYGUN, EvTeklifDurum.KESIF_REVIZE] } },
        data: { durum: EvTeklifDurum.KABUL, kabulTarihi: new Date(), kabulIp: ip ?? null },
      });
      if (tKilit.count !== 1) throw new ConflictException('Teklif kabul edilemedi (durum degismis)');
      await tx.evTeklif.updateMany({
        where: { evIlaniId: ilan.id, id: { not: teklif.id }, durum: { in: [EvTeklifDurum.ON_TEKLIF, EvTeklifDurum.KESFE_DAVET] } },
        data: { durum: EvTeklifDurum.RED },
      });
      return tx.evTeklif.findUnique({ where: { id: teklif.id } });
    });
    // Kural 5: iki sozlesme ayni anda (onayla idempotent; hata durumunda kabul geri alinmaz - defter tamamlanabilir)
    await this.sozlesme.onayla(user.id, SozlesmeTipi.EVDEN_EVE_TASITAN, ip);
    await this.sozlesme.onayla(teklif.tasiyanId, SozlesmeTipi.EVDEN_EVE_TASIYAN, ip);
    // Tasiyana haber (kuyruktan)
    const tasiyan = await this.prisma.user.findUnique({ where: { id: teklif.tasiyanId }, select: { phone: true } });
    if (tasiyan?.phone) {
      await this.kuyruk.ekle('BILDIRIM_SMS', { alici: tasiyan.phone, sablonKodu: 'TEKLIF_KABUL', degiskenler: { ilan: `${ilan.neredenIl} - ${ilan.nereyeIl} (evden eve)` } });
    }
    return sonuc;
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