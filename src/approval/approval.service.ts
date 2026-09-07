// APPROVAL SERVICE (CORE-3) — ChangeRequest yasam dongusu: submit / approve / reject.
//
// SORUMLULUK SINIRI:
//   - Lifecycle ve transaction sahibi BURASIDIR (D117).
//   - Stale/conflict karari BURADA verilir; adapter yalnizca iki snapshot uretir (D116).
//   - Reviewer bagimsizligi BURADA cozulur; MarketService/CatalogService bagimliligi
//     YOKTUR, adapter'a ownership sorulmaz (D125).
//   - Domain yazimi adapter'a birakilir ve HER ZAMAN bu servisin actigi tx ile
//     yapilir; adapter kendi kok transaction'ini acamaz (D124).
//
// KAPSAM DISI (D122): controller, HTTP ucu, DTO dosyasi, yeni izin, AppModule
// wiring, gercek domain adapter'i. Bu servis bugun hicbir uctan cagrilmiyor.
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BusinessUnit,
  ChangeRequest,
  ChangeRequestAction,
  ChangeRequestStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { AdapterRegistry } from './adapter/adapter-registry';
import { ApprovalAdapterContext } from './adapter/approval-adapter.interface';

// Servis-yerel minimum girdi sozlesmeleri. DTO dosyasi BILEREK acilmadi (D122):
// bunlar HTTP govdesi degil, servis imzasidir; alan dogrulamasi adapter'in isidir.
export interface ApprovalSubmitInput {
  entityType: string;
  // CREATE'te null (D121). ChangeRequest.entityId ile ayni sekil.
  entityId: string | null;
  actionType: ChangeRequestAction;
  storeId?: string | null;
  businessUnit?: BusinessUnit | null;
  proposedData: unknown;
  requestedById: string;
  ip?: string | null;
}

export interface ApprovalApproveInput {
  changeRequestId: string;
  reviewerId: string;
  ip?: string | null;
}

export interface ApprovalRejectInput {
  changeRequestId: string;
  reviewerId: string;
  // Semadaki GERCEK alan: ChangeRequest.rejectionReason (reviewNote DEGIL).
  rejectionReason: string;
  ip?: string | null;
}

// Bagimsizlik kontrolu icin gereken DAR ChangeRequest yuzeyi. Tam kaydi tasimak
// yerine bu sekil kullanilir ki helper'in NEYI okudugu imzadan gorulsun.
type IncelemeBaglami = Pick<ChangeRequest, 'requestedById' | 'storeId'>;

/**
 * D116 — YAPISAL SNAPSHOT KARSILASTIRMASI.
 *
 * Yalnizca adapter'in urettigi iki snapshot karsilastirilir; production nesnesinin
 * tamami DEGIL. Hangi alanin "approval-relevant" oldugunu adapter'in snapshot
 * icerigi belirler - updatedAt/computed alanlar snapshot'a girmezse yanlis stale
 * uretmezler.
 *
 * KURALLAR:
 *   - Nesne ANAHTAR SIRASI onemsizdir: {a:1,b:2} ile {b:2,a:1} ESITTIR.
 *   - Dizi SIRASI ANLAMLIDIR; siralama YAPILMAZ (bir listenin sirasi is anlami
 *     tasiyabilir - or. calisma saati araliklari).
 *   - Primitive/null semantigi korunur: null ile undefined ayni sayilmaz,
 *     0 ile '0' ayni sayilmaz.
 *   - Kapsam Prisma Json degerleridir; class/function/Date destegi BILEREK YOK.
 *
 * Repo'da hazir bir derin-esitlik yardimcisi YOK (arama: deepEqual / isEqual /
 * stableStringify -> 0 sonuc). Yeni bagimlilik eklemek yerine servis-yerel
 * minimum yardimci yazildi.
 */
export function snapshotEsit(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  const aDizi = Array.isArray(a);
  const bDizi = Array.isArray(b);
  if (aDizi !== bDizi) return false;

  if (aDizi && bDizi) {
    const x = a as unknown[];
    const y = b as unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      if (!snapshotEsit(x[i], y[i])) return false;
    }
    return true;
  }

  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const xAnahtarlar = Object.keys(x);
  if (xAnahtarlar.length !== Object.keys(y).length) return false;
  for (const anahtar of xAnahtarlar) {
    if (!Object.prototype.hasOwnProperty.call(y, anahtar)) return false;
    if (!snapshotEsit(x[anahtar], y[anahtar])) return false;
  }
  return true;
}

@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AdapterRegistry,
    private readonly audit: AuditService,
  ) {}

  /**
   * TALEP OLUSTUR.
   *
   * D115: entityId DOLU ise ayni (entityType, entityId) hedefindeki aktif PENDING
   *   SUPERSEDED'a cekilir ve yeni kayit supersedesId ile ona baglanir. Hedef
   *   kimligi YALNIZ (entityType, entityId)'dir; actionType / storeId /
   *   businessUnit kimlige DAHIL DEGILDIR.
   * D121: entityId NULL ise (CREATE) onceki PENDING ARANMAZ, supersede YAPILMAZ;
   *   ayni anda birden fazla bagimsiz CREATE talebi bulunabilir.
   * D117: supersede + create + audit AYNI transaction.
   * D118: ayni hedef icin es zamanli ikinci PENDING yarisi DB'de kismi unique
   *   index ile durdurulur; P2002 asagida ConflictException'a cevrilir.
   */
  async submit(input: ApprovalSubmitInput): Promise<ChangeRequest> {
    const adapter = this.registry.resolve(input.entityType);
    const baglam: ApprovalAdapterContext = {
      actionType: input.actionType,
      storeId: input.storeId ?? null,
      businessUnit: input.businessUnit ?? null,
    };

    // Dogrulama transaction DISINDA: validateProposedData tx ALMAZ (sozlesme
    // geregi saf dogrulama/normalizasyon) ve gecersiz veri icin transaction
    // acmanin anlami yok.
    const dogrulanmisVeri = await adapter.validateProposedData(input.proposedData, baglam);

    try {
      return await this.prisma.$transaction(async (tx) => {
        let supersedesId: string | null = null;

        if (input.entityId !== null) {
          const onceki = await tx.changeRequest.findFirst({
            where: {
              entityType: input.entityType,
              entityId: input.entityId,
              status: ChangeRequestStatus.PENDING,
            },
            select: { id: true },
          });
          if (onceki) {
            await tx.changeRequest.update({
              where: { id: onceki.id },
              data: { status: ChangeRequestStatus.SUPERSEDED },
            });
            supersedesId = onceki.id;
          }
        }

        const beforeData = await adapter.buildBeforeData(tx, input.entityId, baglam);

        const olusan = await tx.changeRequest.create({
          data: {
            entityType: input.entityType,
            entityId: input.entityId,
            actionType: input.actionType,
            storeId: input.storeId ?? null,
            businessUnit: input.businessUnit ?? null,
            status: ChangeRequestStatus.PENDING,
            requestedById: input.requestedById,
            // ORIJINAL DEGIL DOGRULANMIS/NORMALIZE veri yazilir: onaylandiginda
            // uygulanacak olan, adapter'in dondurdugu sekildir.
            proposedData: dogrulanmisVeri as Prisma.InputJsonValue,
            beforeData: this.jsonaCevir(beforeData),
            supersedesId,
          },
        });

        await this.audit.recordWithTx(tx, {
          actorId: input.requestedById,
          action: 'approval.submit',
          entity: 'ChangeRequest',
          entityId: olusan.id,
          ip: input.ip ?? null,
          metadata: {
            entityType: olusan.entityType,
            hedefEntityId: olusan.entityId,
            actionType: olusan.actionType,
            storeId: olusan.storeId,
            businessUnit: olusan.businessUnit,
            supersedesId,
          },
        });

        return olusan;
      });
    } catch (e) {
      // D118 yarisi: kismi unique index ihlali. Repo deseni (load.service.ts:952,
      // evdeneve.service.ts:317) aynen kullanilir; yeni exception sinifi uretilmez.
      if (this.p2002Mi(e)) {
        throw new ConflictException(
          'Bu hedef icin zaten bekleyen bir degisiklik talebi var',
        );
      }
      throw e;
    }
  }

  /**
   * ONAYLA.
   *
   * SIRA (C3A-001): revalidate -> stale kontrolu -> KOSULLU SAHIPLENME -> count
   *   kontrolu -> adapter.apply -> audit. Sahiplenme apply'dan ONCE gelir.
   *
   * D117: sahiplenme + adapter.apply + kritik audit TEK transaction. Herhangi biri
   *   patlarsa hicbiri kalmaz.
   * D116: beforeData ile onay anindaki guncel snapshot karsilastirilir; farkliysa
   *   sahiplenme de apply de yapilmaz, onay izi yazilmaz.
   * D123/D125: bagimsizlik kontrolu sahiplenmeden ONCE ve reject ile AYNI helper.
   */
  async approve(input: ApprovalApproveInput): Promise<ChangeRequest> {
    return this.prisma.$transaction(async (tx) => {
      const talep = await tx.changeRequest.findUnique({
        where: { id: input.changeRequestId },
      });
      if (!talep) throw new NotFoundException('Degisiklik talebi bulunamadi');
      this.bekliyorMuDogrula(talep.status);

      const adapter = this.registry.resolve(talep.entityType);
      await this.incelemeBagimsizligiDogrula(tx, talep, input.reviewerId);

      const baglam: ApprovalAdapterContext = {
        actionType: talep.actionType,
        storeId: talep.storeId,
        businessUnit: talep.businessUnit,
      };

      const guncelSnapshot = await adapter.revalidateCurrentState(
        tx,
        talep.entityId,
        baglam,
      );

      if (!snapshotEsit(talep.beforeData ?? null, guncelSnapshot ?? null)) {
        // BAYAT TALEP: hedef, talep olusturulduktan sonra degismis. Uygulamak,
        // talep sahibinin GORMEDIGI bir hali ezmek olurdu.
        throw new ConflictException(
          'Talep olusturulduktan sonra kayit degisti; lutfen talebi yenileyin',
        );
      }

      // C3A-001 — ATOMIK SAHIPLENME (conditional claim), apply'dan ONCE.
      //
      // Yukaridaki findUnique on-kontrolu KULLANICI HATASINI erken ve okunabilir
      // bicimde dondurmek icindir; ESZAMANLILIK GARANTISI DEGILDIR. Gercek garanti
      // asagidaki kosullu yazimdir: WHERE'e beklenen durum konur, count kontrol
      // edilir. READ COMMITTED'da ikinci islem satir kilidini bekler, kilit
      // birakilinca WHERE YENIDEN degerlendirilir; durum artik PENDING olmadigi
      // icin 0 satir gunceller ve burada durulur.
      //
      // Repo emsali: OrderStatusService.gecis (orders/order-status.service.ts) ve
      // SellerStatusService.gecis (market/seller-status.service.ts) - ayni desen,
      // yeni soyutlama uretilmedi.
      //
      // NEDEN APPLY'DAN ONCE: sahiplenmeyi kaybeden transaction bu satirdan sonraya
      // HIC gecemez, dolayisiyla adapter.apply EN FAZLA BIR KEZ calisir. Sahiplenme
      // + apply + audit hala AYNI transaction icinde oldugu icin D117 bozulmaz;
      // apply ya da audit patlarsa sahiplenme de geri sarilir.
      const reviewedAt = new Date();
      const sahiplenme = await tx.changeRequest.updateMany({
        where: { id: talep.id, status: ChangeRequestStatus.PENDING },
        data: {
          status: ChangeRequestStatus.APPROVED,
          reviewedById: input.reviewerId,
          reviewedAt,
        },
      });
      if (sahiplenme.count !== 1) {
        throw new ConflictException(
          'Bu degisiklik talebi artik beklemede degil veya es zamanli olarak islendi',
        );
      }

      await adapter.apply(tx, {
        entityId: talep.entityId,
        actionType: talep.actionType,
        proposedData: talep.proposedData,
        context: baglam,
      });

      // updateMany BatchPayload dondurur; public sozlesme Promise<ChangeRequest>.
      // IKINCI bir durum yazimi YAPILMAZ - guncel satir yalnizca AYNI tx uzerinden
      // okunur (repo emsali: catalog.service.ts updateMany sonrasi findUniqueOrThrow).
      const sonuc = await tx.changeRequest.findUniqueOrThrow({
        where: { id: talep.id },
      });

      await this.audit.recordWithTx(tx, {
        actorId: input.reviewerId,
        action: 'approval.approve',
        entity: 'ChangeRequest',
        entityId: sonuc.id,
        ip: input.ip ?? null,
        metadata: {
          entityType: sonuc.entityType,
          hedefEntityId: sonuc.entityId,
          actionType: sonuc.actionType,
          storeId: sonuc.storeId,
          businessUnit: sonuc.businessUnit,
          requestedById: sonuc.requestedById,
        },
      });

      return sonuc;
    });
  }

  /**
   * REDDET.
   *
   * SIRA (C3A-001): on-kontrol -> bagimsizlik -> KOSULLU SAHIPLENME -> count
   *   kontrolu -> audit. adapter.apply ve registry.resolve HIC CAGRILMAZ.
   *
   * D117: sahiplenme + kritik audit ayni transaction.
   * D123/D125: approve ile AYNI bagimsizlik helper'i.
   */
  async reject(input: ApprovalRejectInput): Promise<ChangeRequest> {
    return this.prisma.$transaction(async (tx) => {
      const talep = await tx.changeRequest.findUnique({
        where: { id: input.changeRequestId },
      });
      if (!talep) throw new NotFoundException('Degisiklik talebi bulunamadi');
      this.bekliyorMuDogrula(talep.status);

      await this.incelemeBagimsizligiDogrula(tx, talep, input.reviewerId);

      // C3A-001 — ATOMIK SAHIPLENME. approve ile AYNI desen: on-kontrol okunabilirlik
      // icin, gercek eszamanlilik garantisi kosullu yazimda. Boylece approve<->reject
      // yarisinda YALNIZ BIRI kazanir; kaybeden Conflict alir ve hicbir yazim yapmaz.
      const reviewedAt = new Date();
      const sahiplenme = await tx.changeRequest.updateMany({
        where: { id: talep.id, status: ChangeRequestStatus.PENDING },
        data: {
          status: ChangeRequestStatus.REJECTED,
          reviewedById: input.reviewerId,
          reviewedAt,
          rejectionReason: input.rejectionReason,
        },
      });
      if (sahiplenme.count !== 1) {
        throw new ConflictException(
          'Bu degisiklik talebi artik beklemede degil veya es zamanli olarak islendi',
        );
      }

      // IKINCI durum yazimi YOK; guncel satir ayni tx uzerinden okunur.
      const sonuc = await tx.changeRequest.findUniqueOrThrow({
        where: { id: talep.id },
      });

      await this.audit.recordWithTx(tx, {
        actorId: input.reviewerId,
        action: 'approval.reject',
        entity: 'ChangeRequest',
        entityId: sonuc.id,
        ip: input.ip ?? null,
        metadata: {
          entityType: sonuc.entityType,
          hedefEntityId: sonuc.entityId,
          actionType: sonuc.actionType,
          storeId: sonuc.storeId,
          businessUnit: sonuc.businessUnit,
          requestedById: sonuc.requestedById,
          rejectionReason: input.rejectionReason,
        },
      });

      return sonuc;
    });
  }

  /**
   * D123 + D125 — REVIEWER BAGIMSIZLIGI. approve ve reject AYNI kapidan gecer.
   *
   * FAIL-CLOSED: bag cozulemiyorsa ONAY VERILMEZ.
   *
   * ADMIN/SUPER_ADMIN muafiyeti YOKTUR - bu yuzden metod rol bilgisi hic ALMAZ;
   * bypass yazilabilecek bir yuzey birakilmadi. ("Bu kisi inceleyebilir mi"
   * yetkilendirme sorusu AYRIDIR, OD-C3-02 kapsamindadir ve bu servisin isi degil.)
   *
   * Yalnizca CEKIRDEK tablolar okunur (D125): change_requests, stores, store_users.
   * MarketService / CatalogService CAGRILMAZ, adapter'a ownership SORULMAZ.
   *
   * store_users NEDEN OTORITE: magaza kadrosunun yasam dongusu ve isActive bayragi
   * orada. user_roles.storeId ile AYNI transaction'da senkron tutuluyor
   * (market.service.ts personelEkle / personelDurum / aktifUyelikDogrula) - pasif
   * uyeye rol satiri yazilamiyor, dolayisiyla iki kaynak celismez.
   */
  private async incelemeBagimsizligiDogrula(
    tx: Prisma.TransactionClient,
    talep: IncelemeBaglami,
    reviewerId: string,
  ): Promise<void> {
    if (talep.requestedById === reviewerId) {
      throw new ForbiddenException('Kendi olusturdugunuz talebi inceleyemezsiniz');
    }

    if (talep.storeId === null) {
      // OD-C3-03A ACIK: magaza kapsami olmayan talepte (or. CREATE) bagimsizlik
      // kanonik olarak cozulemiyor. Tahmin uretmek yerine KAPALI tarafta kaliniyor;
      // seller-level ownership Store.sellerId uzerinden UYDURULMAZ.
      throw new ForbiddenException(
        'Talebin magaza kapsami cozulemedi; bagimsiz inceleme dogrulanamiyor',
      );
    }

    const magaza = await tx.store.findUnique({
      where: { id: talep.storeId },
      select: { ownerId: true },
    });
    if (!magaza) {
      throw new ForbiddenException(
        'Talebin magazasi bulunamadi; bagimsiz inceleme dogrulanamiyor',
      );
    }
    if (magaza.ownerId === reviewerId) {
      throw new ForbiddenException('Kendi magazanizin talebini inceleyemezsiniz');
    }

    const uyelik = await tx.storeUser.findFirst({
      where: { storeId: talep.storeId, userId: reviewerId, isActive: true },
      select: { id: true },
    });
    if (uyelik) {
      throw new ForbiddenException(
        'Magaza personeli o magazanin talebini inceleyemez',
      );
    }
  }

  /** PENDING disindaki hicbir durum tekrar islenemez (APPROVED/REJECTED/SUPERSEDED). */
  private bekliyorMuDogrula(durum: ChangeRequestStatus): void {
    if (durum !== ChangeRequestStatus.PENDING) {
      throw new ConflictException(
        `Talep bu islem icin uygun degil (guncel durum: ${durum}; beklenen: PENDING)`,
      );
    }
  }

  /**
   * Nullable Json kolonu icin Prisma ayrimi: JS null'i dogrudan yazilamaz.
   * CREATE'te beforeData YOKTUR -> SQL NULL (DbNull); boylece geri okundugunda
   * null gelir ve snapshot karsilastirmasi tutarli kalir.
   */
  private jsonaCevir(deger: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
    return deger === null || deger === undefined
      ? Prisma.DbNull
      : (deger as Prisma.InputJsonValue);
  }

  /** Prisma benzersizlik ihlali (D118 kismi unique index yarisi). */
  private p2002Mi(e: unknown): boolean {
    return (
      typeof e === 'object' &&
      e !== null &&
      (e as { code?: unknown }).code === 'P2002'
    );
  }
}
