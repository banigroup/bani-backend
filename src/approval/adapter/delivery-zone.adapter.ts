// TESLIMAT BOLGESI ADAPTER — ILK GERCEK APPROVAL ADAPTER'I.
//
// KAPSAM: yalnizca "magazanin teslimat bolgesi/ucret listesi" yuzeyi.
// Hedef kimligi (D115/D118): entityType = 'DELIVERY_ZONE', entityId = Store.id.
// UPDATE-only: liste her zaman mevcut bir magazaya aittir, CREATE yolu YOKTUR
// (OD-C3-03A bu adapter tarafindan ACILMAZ).
//
// D124 Option A: adapter KENDI Prisma yazma yolunu KURMAZ. Yazma tek kapidan,
// MarketService.teslimatBolgeleriYazTx uzerinden gecer - panel yolu da ayni
// metodu cagirir, dolayisiyla eszamanlilik protokolu atlanamaz.
//
// D134: yazma, Store.deliveryZoneRevision uzerinde CAS ile korunur.
// D135: proposedData onay aninda, ayni transaction icinde, guncel referans
//       veriye (platform_hizmet_bolgeleri) karsi YENIDEN dogrulanir.
import { BadRequestException, Injectable } from '@nestjs/common';
import { ChangeRequestAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MarketService, TeslimatBolgeGirdi } from '../../market/market.service';
import {
  ApprovalAdapter,
  ApprovalAdapterContext,
  ApprovalApplyInput,
} from './approval-adapter.interface';

/** Registry cozumleme anahtari; ChangeRequest.entityType ile birebir. */
export const DELIVERY_ZONE_ENTITY_TYPE = 'DELIVERY_ZONE';

/**
 * Adapter'in urettigi KANONIK SNAPSHOT (D116).
 *
 * Yalnizca approval acisindan ANLAMLI alanlar: bolge listesi + eszamanlilik
 * belirteci. id/createdAt/updatedAt gibi operasyonel alanlar BILEREK disarida -
 * yoksa her yazim yanlis "bayat" uretirdi.
 *
 * revision NEDEN SNAPSHOT'TA: liste karsilastirmasi A -> B -> A donusunu
 * goremez; revision icerikten bagimsiz olarak "arada birileri yazdi" der.
 *
 * JSON-SAFE: yalnizca string | number | null. BigInt/Date YOK.
 */
export interface DeliveryZoneSnapshot {
  revision: number;
  bolgeler: Array<{
    il: string;
    ilce: string;
    mahalle: string | null;
    feeKurus: number | null;
  }>;
}

/**
 * Dogrulanmis/normalize edilmis proposedData (ChangeRequest.proposedData'ya
 * bu sekil yazilir).
 *
 * beklenenRevision NEDEN BURADA: ApprovalApplyInput yalnizca
 * { entityId, actionType, proposedData, context } tasir - beforeData'yi
 * TASIMAZ. Bu yuzden CAS'in beklenen degeri, Core'un onayladigi taban
 * anlik goruntusuyle ayni tur olan proposedData zarfinda tasinir.
 *
 * Guvenlik yonu: Core, approve aninda beforeData ile guncel snapshot'i
 * karsilastirir ve revision snapshot'in PARCASI oldugu icin, revision degismisse
 * apply'a HIC gelinmez (stale -> Conflict). Apply'a gelindiginde guncel revision
 * = taban revision olur ve CAS tam olarak dogru degere karsi calisir.
 */
export interface DeliveryZoneProposedData {
  beklenenRevision: number;
  bolgeler: TeslimatBolgeGirdi[];
}

@Injectable()
export class DeliveryZoneAdapter implements ApprovalAdapter {
  readonly entityType = DELIVERY_ZONE_ENTITY_TYPE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly market: MarketService,
  ) {}

  /**
   * SUBMIT ANI dogrulamasi.
   *
   * Sozlesme geregi tx ALMAZ; bu yuzden kok istemciyle calisir. Erken geri
   * bildirim icindir - TEK BASINA YETERLI DEGILDIR (D135): asil dogrulama
   * apply aninda, transaction icinde tekrar yapilir.
   *
   * Cikti kanonik hale getirilmis satirlar + o andaki revision'dir; Core bu
   * cikti'yi proposedData olarak persist eder (approval.service.ts).
   */
  async validateProposedData(
    proposedData: unknown,
    context: ApprovalAdapterContext,
  ): Promise<unknown> {
    this.aksiyonDogrula(context.actionType);
    // AUDIT-001: burada YALNIZCA kapsam alani dogrulanabiliyor - sozlesme bu
    // metoda entityId vermiyor. Esitlik invariant'i submit'in AYNI
    // transaction'inda buildBeforeData tarafindan, ChangeRequest yazilmadan
    // ONCE uygulaniyor (bkz. hedefMagazaIdCoz).
    const storeId = this.magazaIdGerekli(context.storeId, 'storeId');
    const ham = this.girdiCoz(proposedData);

    // Ayni kural kaynagi: panel yolunun kullandigi DB-bagimli dogrulayici.
    // Kural kopyalanmaz. (PrismaService yapisal olarak TransactionClient'i
    // karsilar; burada transaction yok cunku sozlesme tx vermiyor.)
    const kanonik = await this.market.teslimatBolgeleriDogrulaTx(
      this.prisma as unknown as Prisma.TransactionClient,
      storeId,
      ham,
    );

    const magaza = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { deliveryZoneRevision: true },
    });
    if (!magaza) throw new BadRequestException('Mağaza bulunamadı');

    const sonuc: DeliveryZoneProposedData = {
      beklenenRevision: magaza.deliveryZoneRevision,
      bolgeler: kanonik.map((s) => ({
        il: s.il,
        ilce: s.ilce,
        mahalle: s.mahalle ?? null,
        feeKurus: s.feeKurus ?? null,
      })),
    };
    return sonuc;
  }

  /** Talep anindaki kanonik snapshot (ChangeRequest.beforeData). */
  async buildBeforeData(
    tx: Prisma.TransactionClient,
    entityId: string | null,
    context: ApprovalAdapterContext,
  ): Promise<unknown> {
    return this.anlikGoruntu(tx, entityId, context);
  }

  /**
   * Onay anindaki GUNCEL kanonik snapshot. buildBeforeData ile AYNI sekli
   * uretir; Core ikisini karsilastirip stale kararini kendisi verir.
   */
  async revalidateCurrentState(
    tx: Prisma.TransactionClient,
    entityId: string | null,
    context: ApprovalAdapterContext,
  ): Promise<unknown> {
    return this.anlikGoruntu(tx, entityId, context);
  }

  /**
   * ONAYLANAN DEGISIKLIGI UYGULA.
   *
   * Verilen tx DISINA CIKMAZ, kendi transaction'ini acmaz, dogrudan Prisma
   * yazmasi yapmaz. Tum is paylasilan domain primitive'inde:
   *   · D135 — guncel referans veriye karsi YENIDEN dogrulama (ayni tx)
   *   · D134 — beklenen revision ile CAS; uyusmazsa ConflictException
   *   · whole-list replace + revision +1
   */
  async apply(tx: Prisma.TransactionClient, input: ApprovalApplyInput): Promise<void> {
    this.aksiyonDogrula(input.actionType);
    const storeId = this.hedefMagazaIdCoz(input.entityId, input.context.storeId);
    const veri = this.proposedDataCoz(input.proposedData);

    await this.market.teslimatBolgeleriYazTx(
      tx,
      storeId,
      veri.bolgeler,
      veri.beklenenRevision,
    );
  }

  // ----------------------------------------------------------------- yardimci

  private async anlikGoruntu(
    tx: Prisma.TransactionClient,
    entityId: string | null,
    context: ApprovalAdapterContext,
  ): Promise<DeliveryZoneSnapshot> {
    this.aksiyonDogrula(context.actionType);
    const storeId = this.hedefMagazaIdCoz(entityId, context.storeId);
    const goruntu = await this.market.teslimatBolgeleriAnlikGoruntuTx(tx, storeId);
    return {
      revision: goruntu.revision,
      bolgeler: goruntu.bolgeler.map((b) => ({
        il: b.il,
        ilce: b.ilce,
        mahalle: b.mahalle ?? null,
        feeKurus: b.feeKurus ?? null,
      })),
    };
  }

  /** UPDATE-only yuzey: CREATE/DELETE bu adapter tarafindan KARSILANMAZ. */
  private aksiyonDogrula(actionType: ChangeRequestAction): void {
    if (actionType !== ChangeRequestAction.UPDATE) {
      throw new BadRequestException(
        `Teslimat bölgesi talebi yalnızca UPDATE olabilir (gelen: ${actionType})`,
      );
    }
  }

  /** Tek bir mağaza kimliği alanının dolu olmasını şart koşar - fail-closed. */
  private magazaIdGerekli(deger: string | null | undefined, alan: string): string {
    if (typeof deger !== 'string' || deger.length === 0) {
      throw new BadRequestException(
        `Teslimat bölgesi talebi mağaza kimliği olmadan işlenemez (${alan})`,
      );
    }
    return deger;
  }

  /**
   * HEDEF MAGAZA KIMLIGININ TEK KAYNAGI (AUDIT-001).
   *
   * Sozlesme mağaza kimligini IKI ayri alanda tasiyor: ChangeRequest.entityId
   * (adapter'in degistirdigi kayit) ve context.storeId (talebin kapsami). Bu
   * adapter icin ikisi de AYNI SEYDIR - hedef her zaman bir Store.id'dir.
   *
   * NEDEN ZORUNLU: ApprovalService inceleme bagimsizligini (D123/D125)
   * talep.storeId uzerinden olcer, ama apply'i talep.entityId'ye uygular
   * (approval.service.ts:239 vs :293). Ikisi ayrisirsa bagimsizlik YANLIS
   * magazaya karsi dogrulanir ve bir magaza sahibi kendi magazasinin talebini
   * onaylayabilir. Sozlesme bu esitligi sart kosmadigi ve Core domain-agnostik
   * oldugu (baska adapter'larda entityId ile storeId MESRU sekilde farkli
   * olabilir) icin invariant BURADA, adapter'da uygulanir.
   *
   * FAIL-CLOSED: entityId yok, storeId yok ya da ikisi farkli -> islem yapilmaz.
   *
   * KAPSAM NOTU: validateProposedData bu helper'i CAGIRAMAZ, cunku sozlesme o
   * metoda entityId VERMEZ (approval-adapter.interface.ts:50-53) ve sozlesme bu
   * pakette degistirilmiyor. Bosluk yok: submit sirasinda buildBeforeData AYNI
   * transaction icinde ve ChangeRequest yazilmadan ONCE cagriliyor
   * (approval.service.ts:169 -> :171), dolayisiyla esitsiz bir talep hic
   * kaydedilemiyor. apply de ayrica korunuyor (defense in depth): elle/legacy
   * olusturulmus bozuk bir kayit ileride apply'a ulasirsa orada durur.
   */
  private hedefMagazaIdCoz(
    entityId: string | null | undefined,
    storeId: string | null | undefined,
  ): string {
    const hedef = this.magazaIdGerekli(entityId, 'entityId');
    const kapsam = this.magazaIdGerekli(storeId, 'storeId');
    if (hedef !== kapsam) {
      throw new BadRequestException(
        'Teslimat bölgesi talebinde hedef mağaza ile kapsam mağazası aynı olmalı',
      );
    }
    return hedef;
  }

  /** Ham (istemciden gelen) govdeyi dar sekle indirger. */
  private girdiCoz(proposedData: unknown): TeslimatBolgeGirdi[] {
    const govde = proposedData as { bolgeler?: unknown } | null;
    if (typeof govde !== 'object' || govde === null || !Array.isArray(govde.bolgeler)) {
      throw new BadRequestException(
        'Teslimat bölgesi verisi { bolgeler: [...] } biçiminde olmalı',
      );
    }
    return govde.bolgeler.map((ham, i) => {
      const b = ham as Record<string, unknown>;
      if (typeof b !== 'object' || b === null) {
        throw new BadRequestException(`Geçersiz bölge satırı (#${i + 1})`);
      }
      if (typeof b.il !== 'string' || typeof b.ilce !== 'string') {
        throw new BadRequestException(`Bölge satırında il ve ilçe zorunlu (#${i + 1})`);
      }
      const mahalle = b.mahalle;
      if (mahalle !== undefined && mahalle !== null && typeof mahalle !== 'string') {
        throw new BadRequestException(`Bölge satırında mahalle metin olmalı (#${i + 1})`);
      }
      const feeKurus = b.feeKurus;
      if (feeKurus !== undefined && feeKurus !== null && typeof feeKurus !== 'number') {
        throw new BadRequestException(`Bölge satırında ücret sayı olmalı (#${i + 1})`);
      }
      return {
        il: b.il,
        ilce: b.ilce,
        mahalle: (mahalle as string | null | undefined) ?? null,
        feeKurus: (feeKurus as number | null | undefined) ?? null,
      };
    });
  }

  /** Persist edilmis proposedData zarfini geri okur. */
  private proposedDataCoz(proposedData: unknown): DeliveryZoneProposedData {
    const govde = proposedData as { beklenenRevision?: unknown; bolgeler?: unknown } | null;
    if (
      typeof govde !== 'object' ||
      govde === null ||
      !Number.isInteger(govde.beklenenRevision) ||
      !Array.isArray(govde.bolgeler)
    ) {
      throw new BadRequestException(
        'Teslimat bölgesi talebinin içeriği okunamadı; talebi yenileyin',
      );
    }
    return {
      beklenenRevision: govde.beklenenRevision as number,
      bolgeler: this.girdiCoz({ bolgeler: govde.bolgeler }),
    };
  }
}
