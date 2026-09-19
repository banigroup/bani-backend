import { Injectable, ConflictException } from '@nestjs/common';
import { Prisma, SellerStatus } from '@prisma/client';

// SATICI DURUM GECISLERININ TEK YETKILI SAHIBI.
// OrderStatusService'in ikizi: harita + kosullu yazim. O desen bu projede
// siparis tarafinda yaris durumlarini kapatti; ikinci bir yaklasim icat
// edilmedi.
@Injectable()
export class SellerStatusService {
  // DRAFT -> UNDER_REVIEW -> ACTIVE
  //            |      |        |
  //            v      v        v
  //     NEEDS_FIX  REJECTED  SUSPENDED -> ACTIVE
  // CLOSED, UNDER_REVIEW DISINDAKI yasayan durumlardan gidilebilir ve DONUSU
  // YOKTUR. S4.2 (owner karari): CLOSED != REJECTED - basvuru reddi yalniz
  // REJECTED ile yapilir, bu yuzden UNDER_REVIEW -> CLOSED kaldirildi.
  // REJECTED terminal; yeniden basvuru bu kapsamda YOK.
  // NEEDS_FIX ve REJECTED gerekce ister: yalniz karar ucundan (saticiKarar)
  // yazilir, genel durum ucu bu iki hedefi reddeder.
  readonly NEXT_STATUS: Record<SellerStatus, SellerStatus[]> = {
    DRAFT: [SellerStatus.UNDER_REVIEW, SellerStatus.CLOSED],
    UNDER_REVIEW: [SellerStatus.ACTIVE, SellerStatus.NEEDS_FIX, SellerStatus.REJECTED],
    NEEDS_FIX: [SellerStatus.UNDER_REVIEW, SellerStatus.CLOSED],
    ACTIVE: [SellerStatus.SUSPENDED, SellerStatus.CLOSED],
    SUSPENDED: [SellerStatus.ACTIVE, SellerStatus.CLOSED],
    CLOSED: [],
    REJECTED: [],
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
