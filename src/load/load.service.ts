import {
  Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException,
} from '@nestjs/common';
import {
  Role, WalletType, TransactionType, EntryDirection, BusinessUnit,
  YukIlaniDurum, AracIlaniDurum, YukTeklifDurum, AracTipi,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../finance/services/ledger.service';
import { WalletService } from '../finance/services/wallet.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { YukIlaniOlusturDto } from './dto/yuk-ilani-olustur.dto';
import { AracIlaniOlusturDto } from './dto/arac-ilani-olustur.dto';
import { TeklifVerDto } from './dto/teklif-ver.dto';

// BaniLoad komisyon orani: binde 500 = %5
const LOAD_KOMISYON_BINDE = 500n;

@Injectable()
export class LoadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
  ) { }

  // ============ YUK ILANI (yuk veren) ============

  async ilanOlustur(user: AuthUser, dto: YukIlaniOlusturDto) {
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
  async acikIlanlar() {
    return this.prisma.yukIlani.findMany({
      where: { durum: { in: [YukIlaniDurum.ACIK, YukIlaniDurum.TEKLIF_ALINDI] } },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { teklifler: true } } },
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
    return this.prisma.aracIlani.create({
      data: {
        tasiyiciId: user.id,
        aracTipi: dto.aracTipi,
        nereden: dto.nereden,
        nereye: dto.nereye,
        cikisTarihi: new Date(dto.cikisTarihi),
        kapasiteKg: dto.kapasiteKg,
        durum: AracIlaniDurum.MUSAIT,
      },
    });
  }

  async musaitAraclar() {
    return this.prisma.aracIlani.findMany({
      where: { durum: AracIlaniDurum.MUSAIT },
      orderBy: { cikisTarihi: 'asc' },
      include: { tasiyici: { select: { id: true, name: true, surname: true } } },
    });
  }

  async araclarim(user: AuthUser) {
    return this.prisma.aracIlani.findMany({
      where: { tasiyiciId: user.id },
      orderBy: { createdAt: 'desc' },
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

  // ============ TEKLIF (tasiyici verir) ============

  async teklifVer(user: AuthUser, dto: TeklifVerDto) {
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

  async teklifKabul(user: AuthUser, teklifId: string) {
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
        data: { durum: YukTeklifDurum.KABUL },
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
      const tasiyiciWallet = await this.wallet.getOrCreateUserWallet(tasiyiciId);
      const platformWallet = await this.wallet.getSystemWallet(WalletType.PLATFORM);

      await this.ledger.postWithTx(tx, {
        type: TransactionType.FEE,
        businessUnit: BusinessUnit.LOAD,
        reference: `load:${ilanId}:settle`,
        description: 'BaniLoad taşıma komisyonu (%5)',
        lines: [
          { walletId: tasiyiciWallet.id, direction: EntryDirection.DEBIT, amount: komisyon },
          { walletId: platformWallet.id, direction: EntryDirection.CREDIT, amount: komisyon },
        ],
      });

      return { ilan: guncel, tasimaBedeli, komisyon };
    });
  }
}
