import { createHash } from 'crypto';
import {
  Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException,
} from '@nestjs/common';
import {
  Role, WalletType, TransactionType, EntryDirection, BusinessUnit,
  YukIlaniDurum, AracIlaniDurum, YukTeklifDurum, AracTipi,
  KomisyonOdemeYontem, KomisyonOdemeDurum,
  SozlesmeTipi,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../finance/services/ledger.service';
import { WalletService } from '../finance/services/wallet.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { YukIlaniOlusturDto } from './dto/yuk-ilani-olustur.dto';
import { AracIlaniOlusturDto } from './dto/arac-ilani-olustur.dto';
import { TeklifVerDto } from './dto/teklif-ver.dto';
import { KomisyonBildirDto } from './dto/komisyon-bildir.dto';

// BaniLoad komisyon orani: binde 500 = %5
const LOAD_KOMISYON_BINDE = 500n;
// Komisyon borc esigi: bu tutari gecince yeni is alinamaz (kurus). 5.000 TL
const KOMISYON_BORC_ESIGI_KURUS = 1n; // sifir tolerans: odenmemis komisyon varsa yeni is yok

@Injectable()
export class LoadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
  ) { }

  // ============ YUK ILANI (yuk veren) ============

  async ilanOlustur(user: AuthUser, dto: YukIlaniOlusturDto) {
    await this.sozlesmeKontrolu(user.id, SozlesmeTipi.YUK_VEREN); // onaysiz ilan engeli
    return this.prisma.yukIlani.create({
      data: {
        verenId: user.id,
        nereden: dto.nereden,
        nereye: dto.nereye,
        yukTipi: dto.yukTipi,
        tonajKg: dto.tonajKg,
        aracTipiIhtiyaci: dto.aracTipiIhtiyaci ?? null,
        yuklemeTarihi: new Date(dto.yuklemeTarihi),
        aciklama: dto.aciklama ?? null,
        butceKurus: dto.butceKurus != null ? BigInt(dto.butceKurus) : null,
        durum: YukIlaniDurum.ACIK,
      },
    });
  }

  // Acik yuk ilanlari (tasiyici bunlari gorur, teklif verir)
  private bugunBasi(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  async acikIlanlar() {
    return this.prisma.yukIlani.findMany({
      where: { durum: { in: [YukIlaniDurum.ACIK, YukIlaniDurum.TEKLIF_ALINDI] }, yuklemeTarihi: { gte: this.bugunBasi() } },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { teklifler: true } } },
    });
  }

  // Vitrin (giris gerektirmez): son acik ilanlar, sadece guvenli ozet alanlari
  async vitrinSonIlanlar() {
    return this.prisma.yukIlani.findMany({
      where: { durum: YukIlaniDurum.ACIK, yuklemeTarihi: { gte: this.bugunBasi() } },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        id: true,
        nereden: true,
        nereye: true,
        yukTipi: true,
        tonajKg: true,
        aracTipiIhtiyaci: true,
        yuklemeTarihi: true,
        createdAt: true,
      },
    });
  }

  // Yuk verenin kendi ilanlari (tekliflerle birlikte)
  async ilanlarim(user: AuthUser) {
    return this.prisma.yukIlani.findMany({
      where: { verenId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        teklifler: {
          orderBy: { fiyatKurus: 'asc' },
          include: { tasiyici: { select: { id: true, name: true, surname: true, phone: true } } },
        },
      },
    });
  }

  async ilanDetay(id: string) {
    const ilan = await this.prisma.yukIlani.findUnique({
      where: { id },
      include: {
        teklifler: {
          orderBy: { fiyatKurus: 'asc' },
          include: { tasiyici: { select: { id: true, name: true, surname: true } } },
        },
        veren: { select: { id: true, name: true, surname: true } },
      },
    });
    if (!ilan) throw new NotFoundException('Yük ilanı bulunamadı');
    return ilan;
  }

  async ilanIptal(user: AuthUser, id: string) {
    const ilan = await this.prisma.yukIlani.findUnique({ where: { id } });
    if (!ilan) throw new NotFoundException('Yük ilanı bulunamadı');
    if (ilan.verenId !== user.id) throw new ForbiddenException('Bu ilan size ait değil');
    if (ilan.durum === YukIlaniDurum.TASINIYOR || ilan.durum === YukIlaniDurum.TAMAMLANDI) {
      throw new ConflictException('Taşınan veya tamamlanan ilan iptal edilemez');
    }
    return this.prisma.yukIlani.update({
      where: { id },
      data: { durum: YukIlaniDurum.IPTAL },
    });
  }

  // ============ ARAC ILANI (tasiyici) ============

  async aracIlaniOlustur(user: AuthUser, dto: AracIlaniOlusturDto) {
    await this.erisimKontrolu(user.id); // komisyon borc kilidi
    await this.sozlesmeKontrolu(user.id, SozlesmeTipi.TASIYICI); // onaysiz teklif engeli
    return this.prisma.aracIlani.create({
      data: {
        tasiyiciId: user.id,
        aracTipi: dto.aracTipi,
        nereden: dto.nereden,
        nereye: dto.nereye,
        cikisTarihi: new Date(dto.cikisTarihi),
        kapasiteKg: dto.kapasiteKg,
        beklenenFiyatKurus: dto.beklenenFiyatKurus != null ? BigInt(dto.beklenenFiyatKurus) : null,
        aciklama: dto.aciklama ?? null,
        durum: AracIlaniDurum.MUSAIT,
      },
    });
  }

  async musaitAraclar() {
    return this.prisma.aracIlani.findMany({
      where: { durum: AracIlaniDurum.MUSAIT, cikisTarihi: { gte: this.bugunBasi() } },
      orderBy: { cikisTarihi: 'asc' },
      include: { tasiyici: { select: { id: true, name: true, surname: true } } },
    });
  }

  async araclarim(user: AuthUser) {
    return this.prisma.aracIlani.findMany({
      where: { tasiyiciId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        teklifler: {
          orderBy: { fiyatKurus: 'desc' },
          include: { veren: { select: { id: true, name: true, surname: true, phone: true } } },
        },
        seciliTeklif: { include: { veren: { select: { id: true, name: true, surname: true, phone: true } } } },
      },
    });
  }

  async aracIlaniKapat(user: AuthUser, id: string) {
    const arac = await this.prisma.aracIlani.findUnique({ where: { id } });
    if (!arac) throw new NotFoundException('Araç ilanı bulunamadı');
    if (arac.tasiyiciId !== user.id) throw new ForbiddenException('Bu araç ilanı size ait değil');
    return this.prisma.aracIlani.update({
      where: { id },
      data: { durum: AracIlaniDurum.PASIF },
    });
  }


  // ============ ARAC TEKLIF SISTEMI (firma -> arac, kamyoncu onaylar) ============

  async aracTeklifVer(user: AuthUser, dto: { aracIlaniId: string; fiyatKurus: number; mesaj?: string }) {
    await this.sozlesmeKontrolu(user.id, SozlesmeTipi.YUK_VEREN);
    const ilan = await this.prisma.aracIlani.findUnique({ where: { id: dto.aracIlaniId } });
    if (!ilan) throw new NotFoundException('Arac ilani bulunamadi');
    if (ilan.tasiyiciId === user.id) throw new BadRequestException('Kendi araciniza teklif veremezsiniz');
    if (ilan.durum !== AracIlaniDurum.MUSAIT) throw new ConflictException('Bu araca artik teklif verilemez');
    if (dto.fiyatKurus <= 0) throw new BadRequestException('Teklif tutari pozitif olmali');
    const mevcut = await this.prisma.aracTeklif.findFirst({
      where: { aracIlaniId: dto.aracIlaniId, verenId: user.id, durum: YukTeklifDurum.BEKLIYOR },
    });
    if (mevcut) throw new ConflictException('Bu araca zaten bekleyen bir teklifiniz var');
    return this.prisma.aracTeklif.create({
      data: { aracIlaniId: dto.aracIlaniId, verenId: user.id, fiyatKurus: BigInt(dto.fiyatKurus), mesaj: dto.mesaj ?? null, durum: YukTeklifDurum.BEKLIYOR },
    });
  }

  async aracTeklifGeriCek(user: AuthUser, teklifId: string) {
    const teklif = await this.prisma.aracTeklif.findUnique({ where: { id: teklifId } });
    if (!teklif) throw new NotFoundException('Teklif bulunamadi');
    if (teklif.verenId !== user.id) throw new ForbiddenException('Bu teklif size ait degil');
    if (teklif.durum !== YukTeklifDurum.BEKLIYOR) throw new ConflictException('Sadece bekleyen teklif geri cekilebilir');
    return this.prisma.aracTeklif.update({ where: { id: teklifId }, data: { durum: YukTeklifDurum.GERI_CEKILDI } });
  }

  async aracTekliflerim(user: AuthUser) {
    return this.prisma.aracTeklif.findMany({
      where: { verenId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { aracIlani: { select: { id: true, nereden: true, nereye: true, aracTipi: true, durum: true } } },
    });
  }

  async aracTeklifKabul(user: AuthUser, teklifId: string, ip?: string, cihaz?: string) {
    const teklif = await this.prisma.aracTeklif.findUnique({ where: { id: teklifId }, include: { aracIlani: true } });
    if (!teklif) throw new NotFoundException('Teklif bulunamadi');
    const ilan = teklif.aracIlani;
    const kamyoncuMu = ilan.tasiyiciId === user.id;
    const firmaMi = teklif.verenId === user.id;
    if (!kamyoncuMu && !firmaMi) throw new ForbiddenException('Bu teklif sizinle ilgili degil');
    // beklenenTaraf'in onayi bekleniyor: TASIYICI ise kamyoncu, FIRMA ise firma onaylayabilir
    if (teklif.beklenenTaraf === 'TASIYICI' && !kamyoncuMu) throw new ForbiddenException('Su an karsi tarafin yanitini bekliyor');
    if (teklif.beklenenTaraf === 'FIRMA' && !firmaMi) throw new ForbiddenException('Su an karsi tarafin yanitini bekliyor');
    if (teklif.durum !== YukTeklifDurum.BEKLIYOR) throw new ConflictException('Bu teklif degerlendirilemez (zaten islenmis)');
    if (ilan.durum !== AracIlaniDurum.MUSAIT) throw new ConflictException('Bu arac icin artik eslestirme yapilamaz');
    return this.prisma.$transaction(async (tx) => {
      await tx.aracTeklif.update({ where: { id: teklif.id }, data: { durum: YukTeklifDurum.KABUL, kabulTarihi: new Date(), kabulIp: ip ?? null, kabulCihaz: cihaz ?? null } });
      await tx.aracTeklif.updateMany({ where: { aracIlaniId: ilan.id, id: { not: teklif.id }, durum: YukTeklifDurum.BEKLIYOR }, data: { durum: YukTeklifDurum.RED } });
      return tx.aracIlani.update({
        where: { id: ilan.id },
        data: { durum: AracIlaniDurum.DOLU, seciliTeklifId: teklif.id },
        include: { seciliTeklif: { include: { veren: { select: { id: true, name: true, surname: true, phone: true } } } } },
      });
    });
  }

  async aracTeklifReddet(user: AuthUser, teklifId: string) {
    const teklif = await this.prisma.aracTeklif.findUnique({ where: { id: teklifId }, include: { aracIlani: true } });
    if (!teklif) throw new NotFoundException('Teklif bulunamadi');
    const kamyoncuMu = teklif.aracIlani.tasiyiciId === user.id;
    const firmaMi = teklif.verenId === user.id;
    if (!kamyoncuMu && !firmaMi) throw new ForbiddenException('Bu teklif sizinle ilgili degil');
    if (teklif.durum !== YukTeklifDurum.BEKLIYOR) throw new ConflictException('Sadece bekleyen teklif reddedilebilir');
    return this.prisma.aracTeklif.update({ where: { id: teklifId }, data: { durum: YukTeklifDurum.RED } });
  }

  // KARSI TEKLIF: fiyati gunceller, onay sirasini karsi tarafa gecirir
  async aracKarsiTeklif(user: AuthUser, teklifId: string, yeniFiyatKurus: number) {
    const teklif = await this.prisma.aracTeklif.findUnique({ where: { id: teklifId }, include: { aracIlani: true } });
    if (!teklif) throw new NotFoundException('Teklif bulunamadi');
    const ilan = teklif.aracIlani;
    const kamyoncuMu = ilan.tasiyiciId === user.id;
    const firmaMi = teklif.verenId === user.id;
    if (!kamyoncuMu && !firmaMi) throw new ForbiddenException('Bu teklif sizinle ilgili degil');
    if (teklif.beklenenTaraf === 'TASIYICI' && !kamyoncuMu) throw new ForbiddenException('Su an karsi tarafin yanitini bekliyor');
    if (teklif.beklenenTaraf === 'FIRMA' && !firmaMi) throw new ForbiddenException('Su an karsi tarafin yanitini bekliyor');
    if (teklif.durum !== YukTeklifDurum.BEKLIYOR) throw new ConflictException('Bu teklif icin karsi teklif verilemez');
    if (yeniFiyatKurus <= 0) throw new BadRequestException('Fiyat pozitif olmali');
    // sira karsi tarafa gecer
    const yeniTaraf = kamyoncuMu ? 'FIRMA' : 'TASIYICI';
    return this.prisma.aracTeklif.update({
      where: { id: teklifId },
      data: { fiyatKurus: BigInt(yeniFiyatKurus), beklenenTaraf: yeniTaraf as any },
    });
  }

    // ============ TEKLIF (tasiyici verir) ============

  async teklifVer(user: AuthUser, dto: TeklifVerDto) {
    await this.erisimKontrolu(user.id); // komisyon borc kilidi
    await this.sozlesmeKontrolu(user.id, SozlesmeTipi.TASIYICI); // onaysiz teklif engeli
    const ilan = await this.prisma.yukIlani.findUnique({ where: { id: dto.yukIlaniId } });
    if (!ilan) throw new NotFoundException('Yük ilanı bulunamadı');
    if (ilan.verenId === user.id) throw new BadRequestException('Kendi ilanınıza teklif veremezsiniz');
    if (ilan.durum !== YukIlaniDurum.ACIK && ilan.durum !== YukIlaniDurum.TEKLIF_ALINDI) {
      throw new ConflictException('Bu ilana artık teklif verilemez');
    }
    if (dto.fiyatKurus <= 0) throw new BadRequestException('Teklif tutarı pozitif olmalı');

    // Ayni tasiyici ayni ilana tekrar teklif veremez (gincelleme yerine engelle)
    const mevcut = await this.prisma.yukTeklif.findFirst({
      where: { yukIlaniId: dto.yukIlaniId, tasiyiciId: user.id, durum: YukTeklifDurum.BEKLIYOR },
    });
    if (mevcut) throw new ConflictException('Bu ilana zaten bekleyen bir teklifiniz var');

    return this.prisma.$transaction(async (tx) => {
      const teklif = await tx.yukTeklif.create({
        data: {
          yukIlaniId: dto.yukIlaniId,
          tasiyiciId: user.id,
          fiyatKurus: BigInt(dto.fiyatKurus),
          mesaj: dto.mesaj ?? null,
          durum: YukTeklifDurum.BEKLIYOR,
        },
      });
      // Ilan ilk teklifi aldiysa durumu guncelle
      if (ilan.durum === YukIlaniDurum.ACIK) {
        await tx.yukIlani.update({
          where: { id: ilan.id },
          data: { durum: YukIlaniDurum.TEKLIF_ALINDI },
        });
      }
      return teklif;
    });
  }

  async teklifGeriCek(user: AuthUser, teklifId: string) {
    const teklif = await this.prisma.yukTeklif.findUnique({ where: { id: teklifId } });
    if (!teklif) throw new NotFoundException('Teklif bulunamadı');
    if (teklif.tasiyiciId !== user.id) throw new ForbiddenException('Bu teklif size ait değil');
    if (teklif.durum !== YukTeklifDurum.BEKLIYOR) {
      throw new ConflictException('Sadece bekleyen teklif geri çekilebilir');
    }
    return this.prisma.yukTeklif.update({
      where: { id: teklifId },
      data: { durum: YukTeklifDurum.GERI_CEKILDI },
    });
  }

  // Tasiyicinin verdigi teklifler
  async tekliflerim(user: AuthUser) {
    return this.prisma.yukTeklif.findMany({
      where: { tasiyiciId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { yukIlani: { select: { id: true, nereden: true, nereye: true, yukTipi: true, durum: true } } },
    });
  }

  // ============ KABUL = ESLESTIRMENIN KALBI (yuk veren kabul eder) ============

  async teklifKabul(user: AuthUser, teklifId: string, ip?: string, cihaz?: string) {
    const teklif = await this.prisma.yukTeklif.findUnique({
      where: { id: teklifId },
      include: { yukIlani: true },
    });
    if (!teklif) throw new NotFoundException('Teklif bulunamadı');
    const ilan = teklif.yukIlani;
    if (ilan.verenId !== user.id) throw new ForbiddenException('Bu ilan size ait değil');
    if (teklif.durum !== YukTeklifDurum.BEKLIYOR) {
      throw new ConflictException('Bu teklif değerlendirilemez (zaten işlenmiş)');
    }
    if (ilan.durum !== YukIlaniDurum.ACIK && ilan.durum !== YukIlaniDurum.TEKLIF_ALINDI) {
      throw new ConflictException('Bu ilan için artık eşleştirme yapılamaz');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1) Secilen teklif KABUL
      await tx.yukTeklif.update({
        where: { id: teklif.id },
        data: { durum: YukTeklifDurum.KABUL, kabulTarihi: new Date(), kabulIp: ip ?? null, kabulCihaz: cihaz ?? null },
      });
      // 2) Ayni ilandaki diger BEKLEYEN teklifler RED
      await tx.yukTeklif.updateMany({
        where: { yukIlaniId: ilan.id, id: { not: teklif.id }, durum: YukTeklifDurum.BEKLIYOR },
        data: { durum: YukTeklifDurum.RED },
      });
      // 3) Ilan ESLESTI + secili teklif baglan
      const guncel = await tx.yukIlani.update({
        where: { id: ilan.id },
        data: { durum: YukIlaniDurum.ESLESTI, seciliTeklifId: teklif.id },
        include: { seciliTeklif: { include: { tasiyici: { select: { id: true, name: true, surname: true, phone: true } } } } },
      });
      return guncel;
    });
  }

  // ============ IS AKISI: tasima basla / tamamla (+%5 komisyon) ============

  async tasimaBasla(user: AuthUser, ilanId: string) {
    const ilan = await this.prisma.yukIlani.findUnique({ where: { id: ilanId }, include: { seciliTeklif: true } });
    if (!ilan) throw new NotFoundException('Yük ilanı bulunamadı');
    if (!ilan.seciliTeklif) throw new ConflictException('Önce bir teklif kabul edilmeli');
    // Yuk veren ya da secili tasiyici baslatabilir
    const yetkili = ilan.verenId === user.id || ilan.seciliTeklif.tasiyiciId === user.id;
    if (!yetkili) throw new ForbiddenException('Bu işlem için yetkiniz yok');
    if (ilan.durum !== YukIlaniDurum.ESLESTI) throw new ConflictException('İlan eşleşmiş durumda değil');
    return this.prisma.yukIlani.update({
      where: { id: ilanId },
      data: { durum: YukIlaniDurum.TASINIYOR },
    });
  }

  // Tamamla: tasima biter, BaniLoad %5 komisyon keser (ledger'a LOAD etiketiyle)
  async tasimaTamamla(user: AuthUser, ilanId: string) {
    const ilan = await this.prisma.yukIlani.findUnique({
      where: { id: ilanId },
      include: { seciliTeklif: true },
    });
    if (!ilan) throw new NotFoundException('Yük ilanı bulunamadı');
    if (!ilan.seciliTeklif) throw new ConflictException('Eşleşmiş teklif yok');
    const yetkili = ilan.verenId === user.id || ilan.seciliTeklif.tasiyiciId === user.id;
    if (!yetkili) throw new ForbiddenException('Bu işlem için yetkiniz yok');
    if (ilan.durum !== YukIlaniDurum.TASINIYOR) {
      throw new ConflictException('Sadece taşınan ilan tamamlanabilir');
    }

    const tasimaBedeli = ilan.seciliTeklif.fiyatKurus;
    const komisyon = (tasimaBedeli * LOAD_KOMISYON_BINDE) / 10000n; // %5
    const tasiyiciId = ilan.seciliTeklif.tasiyiciId;

    return this.prisma.$transaction(async (tx) => {
      // Ilan TAMAMLANDI
      const guncel = await tx.yukIlani.update({
        where: { id: ilanId },
        data: { durum: YukIlaniDurum.TAMAMLANDI },
      });

      // ASSET-LIGHT: Tasima bedeli (or. 50.000) platforma GIRMEZ; taraflar kendi
      // arasinda oder. BaniLoad yalnizca %5 komisyonu tasiyicidan alacak yazar.
      // Cift tarafli kayit: tasiyici cuzdani DEBIT (komisyon borcu) / platform CREDIT (gelir).
      // ASSET-LIGHT: Komisyon ledger'a yazilmaz; borc komisyonBorcu() ile
      // (tamamlanan tasimalar - onaylanan odemeler) hesaplanir. Boylece
      // tasiyici cuzdaninda bakiye olmadan da tasima tamamlanir.

      return { ilan: guncel, tasimaBedeli, komisyon };
    });
  }

  // ============================================================
  // KOMISYON BORC + TAHSILAT (Faz 1: havale + admin onayi)
  // Borc = (TAMAMLANDI tasimalarin %5 komisyonu) - (ONAYLANDI odemeler)
  // POS entegrasyonu sonrasi KART yolu acilacak.
  // ============================================================

  // Tasiyicinin biriken komisyon borcu (kurus)
  async komisyonBorcu(userId: string): Promise < bigint > {
  // 1) Tamamlanan tasimalarda bu kisi tasiyici ise: komisyon = fiyat * %5
  const tamamlanan = await this.prisma.yukIlani.findMany({
    where: {
      durum: YukIlaniDurum.TAMAMLANDI,
      seciliTeklif: { tasiyiciId: userId },
    },
    include: { seciliTeklif: true },
  });
  let tahakkuk = 0n;
  for(const ilan of tamamlanan) {
    if (ilan.seciliTeklif) {
      tahakkuk += (ilan.seciliTeklif.fiyatKurus * LOAD_KOMISYON_BINDE) / 10000n;
    }
  }
    // 2) Onaylanmis odemeler
    const odemeler = await this.prisma.komisyonOdeme.aggregate({
    where: { tasiyiciId: userId, durum: KomisyonOdemeDurum.ONAYLANDI },
    _sum: { tutarKurus: true },
  });
  const odenen = odemeler._sum.tutarKurus ?? 0n;
  const borc = tahakkuk - odenen;
  return borc > 0n ? borc : 0n;
}

  // UI icin borc durumu (borc, esik, kilitli mi)
  async komisyonDurumu(user: AuthUser) {
  const borc = await this.komisyonBorcu(user.id);
  return {
    borcKurus: borc.toString(),
    esikKurus: KOMISYON_BORC_ESIGI_KURUS.toString(),
    kilitli: borc >= KOMISYON_BORC_ESIGI_KURUS,
  };
}

  // Erisim kontrolu: borc esigi asildiysa yeni is engellenir
  private async erisimKontrolu(userId: string) {
  const borc = await this.komisyonBorcu(userId);
  if (borc >= KOMISYON_BORC_ESIGI_KURUS) {
    const tl = (Number(borc) / 100).toFixed(2);
    throw new ForbiddenException(
      `Biriken komisyon borcunuz ${tl} TL. Devam edebilmek için ödemenizi yapın.`,
    );
  }
}

  // Tasiyici havale bildirimi olusturur (admin onayi bekler)
  async komisyonBildir(user: AuthUser, dto: KomisyonBildirDto) {
  if (dto.yontem === KomisyonOdemeYontem.KART) {
    throw new BadRequestException('Kart ile ödeme yakında aktif olacak. Şimdilik havale/EFT kullanın.');
  }
  if (dto.tutarKurus <= 0) throw new BadRequestException('Tutar pozitif olmalı');
  return this.prisma.komisyonOdeme.create({
    data: {
      tasiyiciId: user.id,
      tutarKurus: BigInt(dto.tutarKurus),
      yontem: KomisyonOdemeYontem.HAVALE,
      durum: KomisyonOdemeDurum.BEKLIYOR,
      dekont: dto.dekont ?? null,
    },
  });
}

  // Tasiyicinin kendi odeme bildirimleri
  async odemelerim(user: AuthUser) {
  return this.prisma.komisyonOdeme.findMany({
    where: { tasiyiciId: user.id },
    orderBy: { createdAt: 'desc' },
  });
}

  // ---- Admin ----

  private isAdmin(user: AuthUser): boolean {
  return user.roles.includes(Role.ADMIN) || user.roles.includes(Role.SUPER_ADMIN);
}

  // Admin: bekleyen tum odeme bildirimleri
  async bekleyenOdemeler(user: AuthUser) {
  if (!this.isAdmin(user)) throw new ForbiddenException('Bu işlem için yetkiniz yok');
  return this.prisma.komisyonOdeme.findMany({
    where: { durum: KomisyonOdemeDurum.BEKLIYOR },
    orderBy: { createdAt: 'asc' },
    include: { tasiyici: { select: { id: true, name: true, surname: true, phone: true } } },
  });
}

  // Admin: odemeyi onayla (borc duser, kilit acilir)
  async komisyonOnayla(user: AuthUser, odemeId: string, adminNot ?: string) {
  if (!this.isAdmin(user)) throw new ForbiddenException('Bu işlem için yetkiniz yok');
  const odeme = await this.prisma.komisyonOdeme.findUnique({ where: { id: odemeId } });
  if (!odeme) throw new NotFoundException('Ödeme bildirimi bulunamadı');
  if (odeme.durum !== KomisyonOdemeDurum.BEKLIYOR) {
    throw new ConflictException('Bu bildirim zaten işlenmiş');
  }
  return this.prisma.komisyonOdeme.update({
    where: { id: odemeId },
    data: {
      durum: KomisyonOdemeDurum.ONAYLANDI,
      onaylayanId: user.id,
      adminNot: adminNot ?? null,
    },
  });
}

  // Admin: odemeyi reddet
  async komisyonReddet(user: AuthUser, odemeId: string, adminNot ?: string) {
  if (!this.isAdmin(user)) throw new ForbiddenException('Bu işlem için yetkiniz yok');
  const odeme = await this.prisma.komisyonOdeme.findUnique({ where: { id: odemeId } });
  if (!odeme) throw new NotFoundException('Ödeme bildirimi bulunamadı');
  if (odeme.durum !== KomisyonOdemeDurum.BEKLIYOR) {
    throw new ConflictException('Bu bildirim zaten işlenmiş');
  }
  return this.prisma.komisyonOdeme.update({
    where: { id: odemeId },
    data: {
      durum: KomisyonOdemeDurum.RED,
      onaylayanId: user.id,
      adminNot: adminNot ?? null,
    },
  });
}


  // ============================================================
  // SOZLESME ONAY (B modeli: uyelikte tek onay + is delili)
  // Metin GECICI taslak; avukat onayindan sonra SURUM guncellenir.
  // ============================================================

  // Gecerli sozlesme surumleri (avukat metni degisince burayi guncelle)
  // Surum degisince kullanicilar yeniden onaylamak zorunda kalir.
  private readonly SOZLESME_SURUM: Record<SozlesmeTipi, string> = {
  [SozlesmeTipi.TASIYICI]: 'v1-taslak',
  [SozlesmeTipi.YUK_VEREN]: 'v1-taslak',
};

  // Metin hash'i: avukat onayli metin sisteme konunca gercek hash ile degisecek.
  // Simdilik surum bazli sabit placeholder (taslak oldugu icin).
  private metinHashUret(tip: SozlesmeTipi, surum: string): string {
  return createHash('sha256').update(`baniload:${tip}:${surum}`).digest('hex');
}

  // Kullanicinin gecerli surum onayi var mi?
  async sozlesmeOnayliMi(userId: string, tip: SozlesmeTipi): Promise < boolean > {
  const surum = this.SOZLESME_SURUM[tip];
  const onay = await this.prisma.sozlesmeOnay.findUnique({
    where: { kullaniciId_sozlesmeTipi_surum: { kullaniciId: userId, sozlesmeTipi: tip, surum } },
  });
  return !!onay;
}

  // UI icin onay durumu
  async sozlesmeDurumu(user: AuthUser, tip: SozlesmeTipi) {
  const surum = this.SOZLESME_SURUM[tip];
  const onayli = await this.sozlesmeOnayliMi(user.id, tip);
  return { sozlesmeTipi: tip, gecerliSurum: surum, onayli };
}

  // Kullanici sozlesmeyi onaylar (uyelikte bir kez; surum degisirse tekrar)
  async sozlesmeOnayla(user: AuthUser, tip: SozlesmeTipi, ip ?: string, cihaz ?: string) {
  const surum = this.SOZLESME_SURUM[tip];
  const metinHash = this.metinHashUret(tip, surum);
  // Idempotent: ayni surum ikinci kez onaylanirsa mevcut kaydi dondur
  const mevcut = await this.prisma.sozlesmeOnay.findUnique({
    where: { kullaniciId_sozlesmeTipi_surum: { kullaniciId: user.id, sozlesmeTipi: tip, surum } },
  });
  if (mevcut) return mevcut;
  return this.prisma.sozlesmeOnay.create({
    data: {
      kullaniciId: user.id,
      sozlesmeTipi: tip,
      surum,
      metinHash,
      ip: ip ?? null,
      cihaz: cihaz ?? null,
    },
  });
}

  // Onaysiz is engeli: gecerli surum onayi yoksa hata firlat
  private async sozlesmeKontrolu(userId: string, tip: SozlesmeTipi) {
  const onayli = await this.sozlesmeOnayliMi(userId, tip);
  if (!onayli) {
    const ad = tip === SozlesmeTipi.TASIYICI ? 'Taşıyıcı' : 'Yük Veren';
    throw new ForbiddenException(
      `Devam edebilmek için ${ad} Üyelik Sözleşmesi'ni onaylamanız gerekir.`,
    );
  }
}


  // ============ KYC PROFIL KAYDET ============
  async profilKaydet(user: AuthUser, dto: any) {
    const kullanici = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!kullanici) throw new NotFoundException('Kullanıcı bulunamadı');
    const roller = kullanici.roles || [];
    if (roller.includes(Role.LOAD_CUSTOMER)) {
      if (!dto.firma) throw new BadRequestException('Firma bilgileri zorunludur');
      const f = dto.firma;
      await this.prisma.loadFirmaProfil.upsert({
        where: { userId: user.id },
        update: { unvan: f.unvan, vergiDairesi: f.vergiDairesi, vkn: f.vkn, yetkiliAd: f.yetkiliAd, yetkiliSoyad: f.yetkiliSoyad, email: f.email, adres: f.adres },
        create: { userId: user.id, unvan: f.unvan, vergiDairesi: f.vergiDairesi, vkn: f.vkn, yetkiliAd: f.yetkiliAd, yetkiliSoyad: f.yetkiliSoyad, email: f.email, adres: f.adres },
      });
    }
    if (roller.includes(Role.CARRIER)) {
      if (!dto.tasiyici) throw new BadRequestException('Taşıyıcı bilgileri zorunludur');
      const t = dto.tasiyici;
      await this.prisma.loadTasiyiciProfil.upsert({
        where: { userId: user.id },
        update: { ad: t.ad, soyad: t.soyad, tcKimlik: t.tcKimlik, email: t.email || '', plaka: t.plaka, ehliyetNo: t.ehliyetNo, srcNo: t.srcNo, kBelgeNo: t.kBelgeNo },
        create: { userId: user.id, ad: t.ad, soyad: t.soyad, tcKimlik: t.tcKimlik, email: t.email || '', plaka: t.plaka, ehliyetNo: t.ehliyetNo, srcNo: t.srcNo, kBelgeNo: t.kBelgeNo },
      });
    }
    return { ok: true };
  }

  async profilDurumu(user: AuthUser) {
    const kullanici = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { loadFirmaProfil: true, loadTasiyiciProfil: true },
    });
    if (!kullanici) throw new NotFoundException('Kullanıcı bulunamadı');
    const roller = kullanici.roles || [];
    const firmaGerekli = roller.includes(Role.LOAD_CUSTOMER);
    const tasiyiciGerekli = roller.includes(Role.CARRIER);
    const firmaTamam = !firmaGerekli || !!kullanici.loadFirmaProfil;
    const tasiyiciTamam = !tasiyiciGerekli || !!kullanici.loadTasiyiciProfil;
    return { firmaGerekli, tasiyiciGerekli, firmaTamam, tasiyiciTamam, tamam: firmaTamam && tasiyiciTamam };
  }

  // ============ KYC BELGE (Cloudinary) ============
  async belgeKaydet(user: AuthUser, tip: string, dosyaUrl: string) {
    const gecerliTipler = ['EHLIYET', 'SRC', 'K_BELGE', 'ARAC_RUHSAT', 'SIGORTA', 'VERGI_LEVHASI', 'IMZA_SIRKULERI', 'DIGER'];
    if (!gecerliTipler.includes(tip)) throw new BadRequestException('Geçersiz belge tipi');
    return this.prisma.loadBelge.create({
      data: { userId: user.id, tip: tip as any, dosyaUrl, durum: 'BEKLIYOR' as any },
    });
  }

  async belgelerim(user: AuthUser) {
    return this.prisma.loadBelge.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ============ ADMIN: BELGE ONAY ============
  async bekleyenBelgeler(user: AuthUser) {
    if (!this.isAdmin(user)) throw new ForbiddenException('Bu işlem için yetkiniz yok');
    return this.prisma.loadBelge.findMany({
      where: { durum: 'BEKLIYOR' as any },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            id: true, phone: true, roles: true,
            loadFirmaProfil: { select: { unvan: true, vkn: true, yetkiliAd: true, yetkiliSoyad: true } },
            loadTasiyiciProfil: { select: { ad: true, soyad: true, tcKimlik: true, plaka: true } },
          },
        },
      },
    });
  }

  async belgeOnayla(user: AuthUser, belgeId: string) {
    if (!this.isAdmin(user)) throw new ForbiddenException('Bu işlem için yetkiniz yok');
    const belge = await this.prisma.loadBelge.findUnique({ where: { id: belgeId } });
    if (!belge) throw new NotFoundException('Belge bulunamadı');
    return this.prisma.loadBelge.update({ where: { id: belgeId }, data: { durum: 'ONAYLANDI' as any } });
  }

  async belgeReddet(user: AuthUser, belgeId: string) {
    if (!this.isAdmin(user)) throw new ForbiddenException('Bu işlem için yetkiniz yok');
    const belge = await this.prisma.loadBelge.findUnique({ where: { id: belgeId } });
    if (!belge) throw new NotFoundException('Belge bulunamadı');
    return this.prisma.loadBelge.update({ where: { id: belgeId }, data: { durum: 'REDDEDILDI' as any } });
  }
}
