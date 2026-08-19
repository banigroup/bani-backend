import {
  Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException,
} from '@nestjs/common';
import {
  Role, WalletType, TransactionType, EntryDirection, OrderStatus, PaymentStatus, DeliveryStatus, BusinessUnit, KargoFirmasi, DeliveryYontem,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../finance/services/ledger.service';
import { WalletService } from '../finance/services/wallet.service';
import { OrderStatusService } from '../orders/order-status.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

// Hatali teslim kodu denemesi siniri. OtpService.maxAttempts ile ayni sayi (5).
const MAX_KOD_DENEME = 5;

// KURYE/ADMIN UCLARININ DONDUGU ALANLAR — teslimKod BILEREK YOK.
// Prisma findMany/update varsayilan olarak TUM skaler alanlari dondurur; select
// yazilmazsa teslim kodu kuryenin kendi yanitinda gorunur ve dogrulama anlamsiz
// hale gelirdi (kurye musteriye sormadan kendi ekranindan okur). Kodu yalnizca
// siparis sahibi gorur (orders.service).
const KURYE_ALAN = {
  id: true, orderId: true, courierId: true, status: true, fee: true, note: true,
  yontem: true, kargoFirmasi: true, takipNo: true,
  teslimKodDogrulandiAt: true, // dogrulandi mi bilgisi kuryeye acik; KODUN KENDISI degil
  assignedAt: true, pickedUpAt: true, deliveredAt: true, createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly orderStatus: OrderStatusService,
  ) { }

  private isCourier(user: AuthUser): boolean {
    const roles = user.roles ?? [];
    return roles.includes(Role.COURIER) || roles.includes(Role.SUPER_ADMIN);
  }

  private assertCourier(user: AuthUser) {
    if (!this.isCourier(user)) {
      throw new ForbiddenException('Bu işlem için kurye yetkisi gerekli');
    }
  }

  // Çarşı (Kervan) siparişleri BANİGO Kurye akışına HİÇ girmez — DicleFul kendi ayrı
  // kargo akışıyla taşır (mimari sınır: KURAL 2/3). available() Çarşı'yı zaten havuzdan
  // dışlıyor ama cargo() DicleFul havuzunda gösteriyordu; claim/pickup/deliver ise
  // businessUnit'e HİÇ bakmıyordu, dolayısıyla bir kurye Çarşı siparişini üstlenip
  // teslim edebiliyordu (yerelde kanıtlandı: claim→pickup→deliver hepsi geçti).
  // businessUnit checkout'ta yazılıp bir daha değişmediği için transaction dışı okuma
  // güvenli; claim/pickup/deliver başında erken guard olarak çağrılır (savunma katmanı).
  private assertKervanDisi(businessUnit: BusinessUnit) {
    if (businessUnit === BusinessUnit.CARSI) {
      throw new ConflictException('Çarşı (Kervan) siparişi BANİGO Kurye ile taşınmaz — DicleFul kargo akışına gider');
    }
  }

  // Sipariş durum geçişi E-4'te OrderStatusService'e taşındı (tek yetkili sahip).
  // Bu servis order.status'a artık this.orderStatus.gecis(...) üzerinden dokunur.

  // Havuz: hazır (READY) ve henüz kuryesi olmayan teslimatlar (Çarşı DIŞI)
  async available(user: AuthUser) {
    this.assertCourier(user);
    return this.prisma.delivery.findMany({
      where: { status: DeliveryStatus.PENDING, order: { status: OrderStatus.READY, businessUnit: { not: BusinessUnit.CARSI } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: {
        ...KURYE_ALAN,
        order: {
          select: {
            id: true, orderNo: true, total: true, deliveryFee: true,
            addressText: true, storeId: true,
            store: { select: { name: true, city: true, district: true, line1: true } },
          },
        },
      },
    });
  }

  // DicleFul kargo havuzu: SADECE Carsi (kargo) siparisleri
  async cargoQueue(user: AuthUser) {
    this.assertCourier(user);
    return this.prisma.delivery.findMany({
      where: { status: DeliveryStatus.PENDING, order: { status: OrderStatus.READY, businessUnit: BusinessUnit.CARSI } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { ...KURYE_ALAN, order: { select: { id: true, orderNo: true, total: true, deliveryFee: true, addressText: true, contactPhone: true, storeId: true, store: { select: { name: true, city: true, district: true, line1: true } } } } },
    });
  }

  // Kuryenin kendi teslimatlari
  async mine(user: AuthUser, status?: string) {
    this.assertCourier(user);
    const where: any = { courierId: user.id };
    if (status && (DeliveryStatus as any)[status]) where.status = status as DeliveryStatus;
    return this.prisma.delivery.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: { ...KURYE_ALAN, order: { select: { id: true, orderNo: true, total: true, status: true, addressText: true } } },
    });
  }

  private async load(id: string) {
    const d = await this.prisma.delivery.findUnique({
      where: { id },
      include: { order: { include: { store: true } } },
    });
    if (!d) throw new NotFoundException('Teslimat bulunamadı');
    return d;
  }

  // Üstlen: PENDING + sipariş READY ise kuryeye ata
  async claim(user: AuthUser, id: string) {
    this.assertCourier(user);
    const d = await this.load(id);
    this.assertKervanDisi(d.order.businessUnit);
    if (d.status !== DeliveryStatus.PENDING) {
      throw new ConflictException('Bu teslimat zaten üstlenilmiş');
    }
    if (d.order.status !== OrderStatus.READY) {
      throw new ConflictException('Sipariş henüz teslimata hazır değil');
    }

    // Koşullu yazma — yukarıdaki iki kontrol transaction DIŞINDA okunmuş veriye bakıyor.
    // `where: { id }` ile yazıldığında aynı anda gelen N kurye sırayla üzerine yazıyordu:
    // hepsi "üstlendin" yanıtı alıyor, teslimat ise son yazana kalıyordu. Diğer kuryeler
    // mağazaya gidip pickup'ta "bu teslimat size atanmamış" duvarına çarpıyordu.
    // Ayrıca iptal edilmiş bir teslimat (CANCELLED) bayat görüntüyle ASSIGNED'a
    // diriltilebiliyordu — parası müşteriye iade edilmiş sipariş için hayalet iş.
    //
    // status + courierId koşulu bunu kapatır: ilk yazan kilidi alır, sonrakiler kilit
    // bırakılınca yeniden değerlendirilen WHERE'e takılır ve 0 satır günceller.
    const { count } = await this.prisma.delivery.updateMany({
      where: {
        id,
        status: DeliveryStatus.PENDING,
        courierId: null,
        order: { status: OrderStatus.READY },
      },
      data: { courierId: user.id, status: DeliveryStatus.ASSIGNED, assignedAt: new Date() },
    });
    if (count === 0) {
      const guncel = await this.prisma.delivery.findUnique({
        where: { id },
        select: { status: true, courierId: true, order: { select: { status: true } } },
      });
      if (guncel?.courierId != null) {
        throw new ConflictException('Bu teslimat bu sırada başka bir kurye tarafından üstlenildi');
      }
      if (guncel?.status !== DeliveryStatus.PENDING) {
        throw new ConflictException(`Bu teslimat artık üstlenilebilir durumda değil (güncel: ${guncel?.status})`);
      }
      throw new ConflictException(`Sipariş artık teslimata uygun değil (güncel: ${guncel?.order?.status})`);
    }

    return this.prisma.delivery.findUnique({
      where: { id },
      select: { ...KURYE_ALAN, order: { select: { id: true, orderNo: true, status: true } } },
    });
  }

  // Aldım: ASSIGNED -> PICKED_UP, sipariş -> ON_THE_WAY
  async pickup(user: AuthUser, id: string) {
    this.assertCourier(user);
    const d = await this.load(id);
    this.assertKervanDisi(d.order.businessUnit);
    if (d.courierId !== user.id && !(user.roles ?? []).includes(Role.SUPER_ADMIN)) {
      throw new ForbiddenException('Bu teslimat size atanmamış');
    }
    if (d.status !== DeliveryStatus.ASSIGNED) {
      throw new ConflictException(`Bu durumda alınamaz: ${d.status}`);
    }
    return this.prisma.$transaction(async (tx) => {
      // claim() siparişi READY iken üstlenilmeye izin verdi; alım da yalnızca oradan olur.
      // Araya iptal girdiyse (CANCELLED) burada durur — kurye teslim aldı sanılmaz.
      await this.orderStatus.gecis(tx, d.orderId, [OrderStatus.READY], {
        status: OrderStatus.ON_THE_WAY,
      });
      return tx.delivery.update({
        where: { id },
        data: { status: DeliveryStatus.PICKED_UP, pickedUpAt: new Date() },
        select: { ...KURYE_ALAN, order: { select: { id: true, orderNo: true, status: true } } },
      });
    });
  }

  // Teslim ettim: PICKED_UP -> DELIVERED, sipariş -> DELIVERED, escrow dağıtımı.
  //
  // TESLIM KANITI: teslimat ancak müşterinin okuduğu 6 haneli kod doğrulanırsa
  // kapanır. Kod doğrulanmadan ne sipariş DELIVERED olur ne de escrow dağıtılır —
  // ikisi de aşağıdaki transaction'ın İÇİNDE, kod kapısının ARDINDA.
  async deliver(user: AuthUser, id: string, teslimKod: string) {
    this.assertCourier(user);
    const d = await this.load(id);
    this.assertKervanDisi(d.order.businessUnit);

    // ARACI (dış kargo firması) yöntemli teslimat, kurye tarafından TAMAMLANAMAZ.
    // aracikurumaVer teslimatı ARACI + PICKED_UP yapar ama courierId'yi temizlemez;
    // bu yüzden daha önce üstlenmiş kurye deliver() çağırınca sahiplik/durum kontrolleri
    // geçiyor ve çarşı-dışı akışta kurye teslimat ücretini escrow'dan tahsil ediyordu
    // (yerelde kanıtlandı: kurye +15,00 TL, :settle yazıldı). Paketin taşımasını dış
    // firma yapıyor; teslim onayı takip no üzerinden yürür, DicleFul kuryesi kapatmaz.
    if (d.yontem === DeliveryYontem.ARACI) {
      throw new ConflictException('Bu teslimat aracı kuruma devredildi, sizin tarafınızdan tamamlanamaz');
    }

    if (d.courierId !== user.id && !(user.roles ?? []).includes(Role.SUPER_ADMIN)) {
      throw new ForbiddenException('Bu teslimat size atanmamış');
    }
    if (d.status !== DeliveryStatus.PICKED_UP) {
      throw new ConflictException(`Bu durumda teslim edilemez: ${d.status}`);
    }

    // ---- TESLIM KODU: erken ret ----
    // Bağlayıcı kontrol bu DEĞİL (o, transaction içindeki koşullu yazım). Buradaki
    // amaç ucuz yoldan durmak ve hatalı denemeyi sayaca yazmak: sayaç artışı
    // transaction'ın İÇİNDE olsaydı hata fırlatınca rollback ile birlikte silinir,
    // deneme sınırı hiç dolmazdı.
    if (!d.teslimKod) {
      throw new ConflictException(
        'Bu teslimatta teslim kodu tanımlı değil; kod doğrulanmadan teslimat kapatılamaz. Destek ile iletişime geçin.',
      );
    }
    if (d.teslimKodDeneme >= MAX_KOD_DENEME) {
      throw new ConflictException('Çok fazla hatalı teslim kodu denemesi. Destek ile iletişime geçin.');
    }
    const girilenKod = (teslimKod ?? '').trim();
    if (girilenKod !== d.teslimKod) {
      const kalan = MAX_KOD_DENEME - (d.teslimKodDeneme + 1);
      await this.prisma.delivery.update({
        where: { id },
        data: { teslimKodDeneme: { increment: 1 } },
      });
      throw new BadRequestException(
        kalan > 0 ? `Teslim kodu hatalı. Kalan deneme: ${kalan}` : 'Teslim kodu hatalı. Deneme hakkı doldu.',
      );
    }

    const order = d.order;
    const isCarsi = order.businessUnit === BusinessUnit.CARSI;

    // Cüzdanları transaction dışında çöz
    const escrow = await this.wallet.getSystemWallet(WalletType.ESCROW);
    const platform = await this.wallet.getSystemWallet(WalletType.PLATFORM);
    const merchantWallet = await this.wallet.getOrCreateUserWallet(order.store.ownerId);
    const courierWallet = await this.wallet.getOrCreateUserWallet(user.id);

    return this.prisma.$transaction(async (tx) => {
      // KOD KAPISI: para kapısından da ÖNCE. Yukarıdaki karşılaştırma transaction
      // DIŞINDA okunmuş veriye bakıyor; aynı kodla gelen ikinci bir istek (çift
      // tıklama, tekrar gönderim) araya girip ikinci kez dağıtım tetikleyebilirdi.
      // Koşullu yazım bunu kapatır: teslimKodDogrulandiAt yalnızca NULL iken
      // damgalanır, ikinci istek 0 satır günceller ve burada durur. Aynı koşul
      // durumu da çiviler — kod doğru olsa bile teslimat PICKED_UP değilse yazmaz.
      const { count } = await tx.delivery.updateMany({
        where: {
          id,
          status: DeliveryStatus.PICKED_UP,
          teslimKod: girilenKod,
          teslimKodDogrulandiAt: null,
        },
        data: { teslimKodDogrulandiAt: new Date() },
      });
      if (count === 0) {
        throw new ConflictException(
          'Teslim kodu bu sırada doğrulanmış ya da teslimat durumu değişmiş; teslimat kapatılmadı.',
        );
      }

      // PARA KAPISI: escrow dağıtımından ÖNCE ve aynı transaction içinde.
      // Sipariş araya giren bir iptalle CANCELLED olduysa burada durulur; aksi hâlde
      // hem satıcı/platform/kuryeye dağıtım hem müşteriye iade yapılır ve escrow'dan
      // aynı para iki kez çıkardı (:settle ve :refund farklı reference'lar olduğu için
      // ledger'daki idempotency bunu YAKALAMAZ).
      await this.orderStatus.gecis(tx, order.id, [OrderStatus.ON_THE_WAY], {
        status: OrderStatus.DELIVERED,
        paymentStatus: PaymentStatus.RELEASED,
        deliveredAt: new Date(),
      });
      const updated = await tx.delivery.update({
        where: { id },
        data: { status: DeliveryStatus.DELIVERED, deliveredAt: new Date() },
        select: { ...KURYE_ALAN, order: { select: { id: true, orderNo: true, status: true } } },
      });

      // ---- Dağıtım ----
      let lines: { walletId: string; direction: EntryDirection; amount: bigint }[];

      if (isCarsi) {
        // Çarşı: kargo ürüne gömülü -> DicleFul'e (şimdilik PLATFORM cüzdanı) gider.
        //   satıcı  = netRevenue (net + mal KDV) — kargoyu ALMAZ
        //   platform = komisyon + hizmet KDV + DicleFul kargo (deliveryFee)
        //   kurye    = order'dan pay almaz (DicleFul kuryesi ayrı ödenir)
        // NOT: komisyon/vat/deliveryFee Order'da ayrı tutulduğu için muhasebe
        //      DicleFul kargosunu platform komisyonundan ayrıştırabilir.
        lines = [
          { walletId: escrow.id, direction: EntryDirection.DEBIT, amount: order.total },
          { walletId: merchantWallet.id, direction: EntryDirection.CREDIT, amount: order.netRevenue },
          { walletId: platform.id, direction: EntryDirection.CREDIT, amount: order.commission + order.vat + order.deliveryFee },
        ];
      } else {
        // Çarşı dışı: mevcut akış — kurye teslimat ücretini alır
        lines = [
          { walletId: escrow.id, direction: EntryDirection.DEBIT, amount: order.total },
          { walletId: merchantWallet.id, direction: EntryDirection.CREDIT, amount: order.netRevenue },
          { walletId: platform.id, direction: EntryDirection.CREDIT, amount: order.commission },
          { walletId: courierWallet.id, direction: EntryDirection.CREDIT, amount: order.deliveryFee },
        ];
      }
      lines = lines.filter((l) => l.amount > 0n);

      await this.ledger.postWithTx(tx, {
        type: TransactionType.PAYMENT,
        reference: `${order.orderNo}:settle`,
        orderNo: order.orderNo,
        businessUnit: order.businessUnit,
        commission: order.commission,
        vat: order.vat,
        deliveryFee: order.deliveryFee,
        netRevenue: order.netRevenue,
        description: isCarsi
          ? `Sipariş ${order.orderNo} dağıtım (satıcı + platform + DicleFul kargo)`
          : `Sipariş ${order.orderNo} dağıtım (satıcı + platform + kurye)`,
        lines,
      });

      return updated;
    });
  }

  // ============================ ARACI KURUMA DEVRET (admin) ============================
  // Sadece ADMIN/SUPER_ADMIN. Teslimatı dış kargo firmasına verir: firma + takip no.
  // İç işleyiş — admin panelinde kullanılır, DicleFul müşteri sayfasında DEĞİL.
  async aracikurumaVer(
    user: AuthUser,
    id: string,
    kargoFirmasi: KargoFirmasi,
    takipNo: string,
  ) {
    if (!(user.roles ?? []).includes(Role.SUPER_ADMIN) && !(user.roles ?? []).includes(Role.ADMIN)) {
      throw new ForbiddenException('Bu işlem için admin yetkisi gerekli');
    }
    const trimmed = (takipNo ?? '').trim();
    if (!trimmed) throw new BadRequestException('Takip no zorunlu');

    const d = await this.load(id);
    if (d.status === DeliveryStatus.DELIVERED || d.status === DeliveryStatus.CANCELLED) {
      throw new ConflictException(`Bu durumda aracı kuruma verilemez: ${d.status}`);
    }

    // takipNo benzersiz olmalı (başka teslimatta kullanılmamış)
    const cakisma = await this.prisma.delivery.findFirst({
      where: { takipNo: trimmed, NOT: { id } },
    });
    if (cakisma) throw new ConflictException('Bu takip no zaten kullanımda');

    // ARACI'ya verilince gönderi yola çıkmış sayılır (PICKED_UP) + sipariş ON_THE_WAY
    return this.prisma.$transaction(async (tx) => {
      // Teslimat henüz havuzdaysa/atanmışsa sipariş READY; zaten yola çıkmışsa ON_THE_WAY.
      // İkisine de izin verilir (kargo firması/takip no sonradan düzeltilebilsin), ama
      // DELIVERED ve CANCELLED siparişte aracı kuruma devir engellenir.
      await this.orderStatus.gecis(
        tx,
        d.orderId,
        [OrderStatus.READY, OrderStatus.ON_THE_WAY],
        { status: OrderStatus.ON_THE_WAY },
      );
      return tx.delivery.update({
        where: { id },
        data: {
          yontem: DeliveryYontem.ARACI,
          kargoFirmasi,
          takipNo: trimmed,
          status: DeliveryStatus.PICKED_UP,
          pickedUpAt: new Date(),
        },
        select: { ...KURYE_ALAN, order: { select: { id: true, orderNo: true, status: true } } },
      });
    });
  }

  // ============================ PUBLIC TAKİP (auth YOK) ============================
  // DicleFul kargo takip sayfası bunu çağırır. Müşteri giriş YAPMADAN takip no ile sorgular.
  // GİZLİLİK: sipariş no / ürün / müşteri / tutar DÖNMEZ — yalnızca lojistik durum.
  async takip(takipNo: string) {
    const t = (takipNo ?? '').trim();
    if (!t) throw new BadRequestException('Takip no giriniz');

    const d = await this.prisma.delivery.findUnique({
      where: { takipNo: t },
      select: {
        status: true,
        kargoFirmasi: true,
        yontem: true,
        assignedAt: true,
        pickedUpAt: true,
        deliveredAt: true,
        updatedAt: true,
        // order / courier / fee / id: BİLEREK seçilmedi (gizlilik)
      },
    });
    if (!d) throw new NotFoundException('Bu takip numarasına ait gönderi bulunamadı');

    // Müşteriye dönük sade durum metni
    const durumMetni: Record<string, string> = {
      PENDING: 'Hazırlanıyor',
      ASSIGNED: 'Kargoya verildi',
      PICKED_UP: 'Yolda',
      DELIVERED: 'Teslim edildi',
      CANCELLED: 'İptal edildi',
    };

    return {
      takipNo: t,
      durum: durumMetni[d.status] ?? d.status,
      kargoFirmasi: d.kargoFirmasi, // null ise DicleFul kendi taşıyor
      sonGuncelleme: d.deliveredAt ?? d.pickedUpAt ?? d.assignedAt ?? d.updatedAt,
      teslimEdildi: d.status === DeliveryStatus.DELIVERED,
    };
  }
}
