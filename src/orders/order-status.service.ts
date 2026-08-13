import { Injectable, ConflictException } from '@nestjs/common';
import { Prisma, OrderStatus } from '@prisma/client';

// Sipariş durum geçişlerinin TEK YETKİLİ SAHİBİ.
//
// E-4 çıkarımı: geçiş haritası (NEXT_STATUS) orders.service'te, koşullu geçiş
// yardımcısı (siparisDurumGecisi) delivery.service'te ayrı yaşıyordu. İkisi de
// buraya toplandı; hem OrdersService hem DeliveryService order.status'a artık bu
// servis üzerinden dokunur — DeliveryService'in Prisma ile doğrudan yazması bitti.
//
// Davranış E-4'te DEĞİŞMEDİ: harita, iptal listesi ve gecis() mantığı taşınmadan
// önceki hâlleriyle birebir aynıdır.
@Injectable()
export class OrderStatusService {
  // Satıcı/admin tarafından ileri durum geçişleri (READY'den sonrasını KURYE devralır)
  readonly NEXT_STATUS: Record<string, OrderStatus[]> = {
    CONFIRMED: [OrderStatus.PREPARING],
    PREPARING: [OrderStatus.READY],
    READY: [], // kurye teslimatı devralır (Faz 4)
    ON_THE_WAY: [],
    DELIVERED: [],
    CANCELLED: [],
    REFUNDED: [],
    PENDING: [OrderStatus.CONFIRMED],
  };

  // İptal edilebilir durumlar (teslimat yola çıkmadan önce)
  readonly CANCELABLE: OrderStatus[] = [
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.READY,
  ];

  // Sipariş durumunu KOŞULLU ilerletir: yalnızca mevcut durum `beklenen` içindeyse yazar.
  //
  // Neden: guard'lar transaction DIŞINDA okunmuş veriye bakıyor. `where: { id }` ile
  // yazıldığında araya giren başka bir yol siparişi değiştirmiş olsa bile üzerine
  // yazılıyordu — iki farklı yol (kurye teslimatı ↔ müşteri iptali) birbirinden habersiz
  // aynı siparişi güncelleyebiliyordu.
  //
  // updateMany + count kontrolü bunu kapatır: Read Committed'da ikinci işlem satır
  // kilidini bekler, kilit bırakılınca WHERE koşulu YENİDEN değerlendirilir; durum artık
  // uymadığı için 0 satır güncellenir ve burada Conflict'e döner. Ek sütun/migration
  // gerekmez. (E-1'de eklendi, E-4'te buraya taşındı.)
  async gecis(
    tx: Prisma.TransactionClient,
    orderId: string,
    beklenen: OrderStatus[],
    data: Prisma.OrderUpdateManyMutationInput,
  ): Promise<void> {
    const { count } = await tx.order.updateMany({
      where: { id: orderId, status: { in: beklenen } },
      data,
    });
    if (count === 0) {
      const guncel = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      throw new ConflictException(
        `Sipariş durumu bu işlem için uygun değil (güncel: ${guncel?.status ?? 'bulunamadı'}; beklenen: ${beklenen.join(' | ')})`,
      );
    }
  }
}
