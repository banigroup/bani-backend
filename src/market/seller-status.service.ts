import { Injectable, ConflictException } from '@nestjs/common';
import { Prisma, SellerStatus } from '@prisma/client';

// SATICI DURUM GECISLERININ TEK YETKILI SAHIBI.
// OrderStatusService'in ikizi: harita + kosullu yazim. O desen bu projede
// siparis tarafinda yaris durumlarini kapatti; ikinci bir yaklasim icat
// edilmedi.
@Injectable()
export class SellerStatusService {
  // DRAFT -> UNDER_REVIEW -> ACTIVE
  //            |               |
  //            v               v
  //         NEEDS_FIX       SUSPENDED -> ACTIVE
  // CLOSED her durumdan gidilebilir ve DONUSU YOKTUR.
  readonly NEXT_STATUS: Record<SellerStatus, SellerStatus[]> = {
    DRAFT: [SellerStatus.UNDER_REVIEW, SellerStatus.CLOSED],
    UNDER_REVIEW: [SellerStatus.ACTIVE, SellerStatus.NEEDS_FIX, SellerStatus.CLOSED],
    NEEDS_FIX: [SellerStatus.UNDER_REVIEW, SellerStatus.CLOSED],
    ACTIVE: [SellerStatus.SUSPENDED, SellerStatus.CLOSED],
    SUSPENDED: [SellerStatus.ACTIVE, SellerStatus.CLOSED],
    CLOSED: [],
  };

  /**
   * KOSULLU GECIS: yalnizca mevcut durum `beklenen` icindeyse yazar.
   * Guard okumasi transaction disinda yapilmis olabilir; araya baska bir yol
   * girip durumu degistirdiyse updateMany 0 satir gunceller ve burada durulur.
   */
  async gecis(
    tx: Prisma.TransactionClient,
    sellerId: string,
    beklenen: SellerStatus[],
    data: Prisma.SellerUpdateManyMutationInput,
  ): Promise<void> {
    const { count } = await tx.seller.updateMany({
      where: { id: sellerId, status: { in: beklenen } },
      data,
    });
    if (count === 0) {
      const guncel = await tx.seller.findUnique({ where: { id: sellerId }, select: { status: true } });
      throw new ConflictException(
        `Satıcı durumu bu işlem için uygun değil (güncel: ${guncel?.status ?? 'bulunamadı'}; beklenen: ${beklenen.join(' | ')})`,
      );
    }
  }

  gecerliMi(mevcut: SellerStatus, hedef: SellerStatus): boolean {
    return (this.NEXT_STATUS[mevcut] ?? []).includes(hedef);
  }
}
