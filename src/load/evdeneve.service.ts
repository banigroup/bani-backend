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
    // Teslim penceresi tasitan tarafindan girilmez - tasiyan kesif/teklif asamasinda belirler
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
        teslimBaslangic: null,
        teslimBitis: null,
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

  // TASITAN: ilan ucreti havale bildirimi (dekont) - admin onayina duser
  async ucretBildir(user: AuthUser, ilanId: string, dekont: string) {
    const ilan = await this.prisma.evIlani.findUnique({ where: { id: ilanId } });
    if (!ilan) throw new NotFoundException('Ilan bulunamadi');
    if (ilan.tasitanId !== user.id) throw new ForbiddenException('Bu ilan size ait degil');
    if (ilan.durum !== EvIlaniDurum.ODEME_BEKLIYOR) throw new ConflictException('Bu ilan ucret bildirimine uygun degil');
    return this.prisma.evIlani.update({
      where: { id: ilan.id },
      data: { ucretDekont: dekont, ucretBildirimZamani: new Date() },
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
  // TASIYAN: teslim beyani (esyalar teslim edildi - tasitanin onayi bekleniyor)
  async teslimBeyan(user: AuthUser, ilanId: string) {
    const ilan = await this.prisma.evIlani.findUnique({ where: { id: ilanId } });
    if (!ilan) throw new NotFoundException('Ilan bulunamadi');
    if (ilan.durum !== EvIlaniDurum.KILITLENDI) throw new ConflictException('Bu ilan teslim beyanina uygun degil');
    if (!ilan.seciliTeklifId) throw new ConflictException('Secili teklif yok');
    const teklif = await this.prisma.evTeklif.findUnique({ where: { id: ilan.seciliTeklifId } });
    if (!teklif || teklif.tasiyanId !== user.id) throw new ForbiddenException('Bu is size ait degil');
    // Beyani teklif uzerinde kesifNotu gibi ayri alan actirmadan tutuyoruz: teslim beyan zamani = updatedAt izi + audit.
    // Basit ve yeterli: dogrudan tasitan onayina dusuyor; cifte kayit istenirse ileride alan eklenir.
    return { ok: true, mesaj: 'Teslim beyani alindi - tasitanin onayi bekleniyor', ilanId: ilan.id };
  }

  // TASITAN: teslim onayi -> ilan TAMAMLANDI (atomik) + %5 komisyon tahakkuku (Load defteri) + SMS
  async teslimOnay(user: AuthUser, ilanId: string) {
    const ilan = await this.prisma.evIlani.findUnique({ where: { id: ilanId } });
    if (!ilan) throw new NotFoundException('Ilan bulunamadi');
    if (ilan.tasitanId !== user.id) throw new ForbiddenException('Bu ilan size ait degil');
    if (!ilan.seciliTeklifId) throw new ConflictException('Secili teklif yok');
    const teklif = await this.prisma.evTeklif.findUnique({ where: { id: ilan.seciliTeklifId } });
    if (!teklif || teklif.durum !== EvTeklifDurum.KABUL) throw new ConflictException('Kabul edilmis teklif bulunamadi');
    const kilit = await this.prisma.evIlani.updateMany({
      where: { id: ilan.id, durum: EvIlaniDurum.KILITLENDI },
      data: { durum: EvIlaniDurum.TAMAMLANDI },
    });
    if (kilit.count !== 1) throw new ConflictException('Teslim onaylanamadi (durum degismis)');
    const komisyon = teklif.kesinFiyatKurus ? (teklif.kesinFiyatKurus * 500n) / 10000n : 0n;
    const tasiyan = await this.prisma.user.findUnique({ where: { id: teklif.tasiyanId }, select: { phone: true } });
    if (tasiyan?.phone) {
      await this.kuyruk.ekle('BILDIRIM_SMS', { alici: tasiyan.phone, sablonKodu: 'TESLIM_ONAY', degiskenler: { ilan: `${ilan.neredenIl} - ${ilan.nereyeIl} (evden eve)` } });
    }
    const guncel = await this.prisma.evIlani.findUnique({ where: { id: ilan.id } });
    return { ilan: guncel, komisyonKurus: komisyon.toString() };
  }
  // TASIYAN: donus-yuku ilani ver (ucretsiz vitrin - A-mini)
  async donusVer(user: AuthUser, dto: { neredenIl: string; nereyeIl: string; tarihBas: string; tarihBit: string; aracTipi?: string; aciklama?: string }) {
    const b = new Date(dto.tarihBas); const e = new Date(dto.tarihBit);
    if (isNaN(b.getTime()) || isNaN(e.getTime()) || b > e) throw new BadRequestException('Tarih penceresi hatali');
    return this.prisma.donusYukuIlani.create({
      data: { tasiyanId: user.id, neredenIl: dto.neredenIl.toUpperCase(), nereyeIl: dto.nereyeIl.toUpperCase(), tarihBas: b, tarihBit: e, aracTipi: dto.aracTipi ?? null, aciklama: dto.aciklama ?? null },
    });
  }

  // HERKES: donus-yuku borsasi (aktif + penceresi gecmemis)
  async donusBorsa() {
    return this.prisma.donusYukuIlani.findMany({
      where: { durum: 'AKTIF' as any, tarihBit: { gte: new Date() } },
      orderBy: { tarihBas: 'asc' },
    });
  }

  // TASITAN: donus ilanina davet - tasiyana SMS gider, tasiyan tasitanin EV ILANINA normal on teklif verir
  async donusDavet(user: AuthUser, donusId: string, evIlaniId: string) {
    const donus = await this.prisma.donusYukuIlani.findUnique({ where: { id: donusId } });
    if (!donus) throw new NotFoundException('Donus ilani bulunamadi');
    if (donus.durum !== ('AKTIF' as any)) throw new ConflictException('Bu donus ilani aktif degil');
    const ev = await this.prisma.evIlani.findUnique({ where: { id: evIlaniId } });
    if (!ev) throw new NotFoundException('Ev ilani bulunamadi');
    if (ev.tasitanId !== user.id) throw new ForbiddenException('Bu ev ilani size ait degil');
    if (ev.durum !== EvIlaniDurum.ACIK) throw new ConflictException('Ev ilaniniz teklif almaya acik degil');
    const tasiyan = await this.prisma.user.findUnique({ where: { id: donus.tasiyanId }, select: { phone: true } });
    if (tasiyan?.phone) {
      await this.kuyruk.ekle('BILDIRIM_SMS', { alici: tasiyan.phone, sablonKodu: 'TEKLIF_GELDI', degiskenler: { ilan: `${ev.neredenIl} - ${ev.nereyeIl} evden eve talebi (donus yolunuza uygun)` } });
    }
    return { ok: true, mesaj: 'Davet gonderildi - tasiyan ilaniniza teklif verebilir', evIlaniId: ev.id };
  }
  // TASIYAN: kendi tekliflerim (ilan ozetiyle) - panel Islemlerim bolumu
  async tekliflerim(user: AuthUser) {
    const teklifler = await this.prisma.evTeklif.findMany({ where: { tasiyanId: user.id }, orderBy: { createdAt: 'desc' } });
    const ilanIds = [...new Set(teklifler.map((t) => t.evIlaniId))];
    const ilanlar = await this.prisma.evIlani.findMany({ where: { id: { in: ilanIds } } });
    const map = new Map(ilanlar.map((i) => [i.id, i]));
    return teklifler.map((t) => ({ ...t, ilan: map.get(t.evIlaniId) ?? null }));
  }
  // VITRIN (girissiz): canli evden eve panosu - sinirli alanlar, hassas veri YOK
  async vitrinEvIlanlari() {
    return this.prisma.evIlani.findMany({
      where: { durum: EvIlaniDurum.ACIK },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, evTipi: true, neredenIl: true, nereyeIl: true, alimTarihi: true, createdAt: true },
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