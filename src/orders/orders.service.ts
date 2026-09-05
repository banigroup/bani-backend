import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException,
} from '@nestjs/common';
import {
  Prisma, Role, WalletType, TransactionType, EntryDirection, OrderStatus, PaymentStatus, DeliveryStatus, BusinessUnit, SellerStatus,
} from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BildirimService } from '../bildirim/bildirim.service';
import { MarketService } from '../market/market.service';
import { LedgerService } from '../finance/services/ledger.service';
import { WalletService } from '../finance/services/wallet.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { platformYoneticisi } from '../common/rbac/rol-kontrol';
import { CheckoutDto } from './dto/checkout.dto';
import { OrderStatusService } from './order-status.service';
import { checkoutOriginUygun, dikeyCoz } from '../common/domain/dikey-domain';
import { etkinStok, etkinKirilim } from '../common/domain/varyant';

// --- Placeholder ayarları (Çarşı DIŞI dikeyler için) ---
const DELIVERY_FEE = 1500n; // 15,00 TL
const FREE_DELIVERY_THRESHOLD = 30000n; // 300 TL ve üzeri teslimat ücretsiz
const VAT_INCLUDED_RATE = 20n; // komisyon KDV dahil; KDV payı = komisyon * 20 / 120

// NEXT_STATUS geçiş haritası ve CANCELABLE listesi E-4'te OrderStatusService'e taşındı
// (sipariş durum geçişlerinin tek yetkili sahibi orası). Buradan onun üzerinden okunur.

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly orderStatus: OrderStatusService,
    private readonly bildirim: BildirimService,
    // Magaza erisim kurali (sahip | personel | platform yoneticisi) TEK YERDE
    // yasiyor: market.service.erisebilir. Burada ikinci bir kopyasi yazilmadi -
    // isAdmin'in iki dosyada ayrisip ADMIN'i kilitlemesi tam olarak boyle olmustu.
    private readonly market: MarketService,
  ) { }

  // Teslim kodu: musteriye bildirilen, kuryenin teslimatta girdigi 6 hane.
  // OtpService ile ayni uretim deseni (crypto.randomInt); Math.random KULLANILMAZ.
  private teslimKoduUret(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  // PLATFORM YONETICISI: ADMIN ve SUPER_ADMIN.
  //
  // Eskiden yalnizca SUPER_ADMIN'i kabul ediyordu; sebep politika degil TARIH:
  // bu satir Faz 3'te (2026-06-14, 1700138) yazildi, ADMIN rolu Faz 5'te
  // (2026-06-20, 794d2c2) eklendi ve o commit bu dosyaya hic dokunmadi. Sonuc:
  // ADMIN'in ORDER_READ/ORDER_MANAGE izni PermissionsGuard'i geciyor ama burada
  // sahiplik kontrolune takiliyordu - izni olan, verisi olmayan bir rol.
  // Load tarafi (load.service.ts:737, evdeneve.service.ts:20) dogru desende;
  // burasi ona hizalandi. ADMIN artik platform operatorudur: tum magazalarin
  // siparislerini gorur ve durum ilerletir. Musteri adres/telefon verisine
  // erisim bu kapsamin bilincli parcasidir.
  // Tanim TEK KAYNAKTA: common/rbac/rol-kontrol. Yukaridaki hikayenin tekrar
  // yasanmamasi icin kopya birakilmadi.
  private isAdmin(user: AuthUser): boolean {
    return platformYoneticisi(user.roles);
  }

  /**
   * Secim satirlarindaki bir kirilim kaleminin toplami (Carsi muhasebesi).
   * NULL = kirilim yok (Carsi disi kalem) -> 0 sayilir. Bir CARSI kaleminde
   * NULL cikarsa toplam eksik kalir ve asagidaki "dagitim == subtotal"
   * guvencesi bunu yakalar: siparis yazilmadan durur, sessizce kaymaz.
   */
  private secimToplam(
    secimler: {
      netFiyat: bigint | null;
      komisyonTutari: bigint | null;
      malKdvTutari: bigint | null;
      hizmetKdvTutari: bigint | null;
    }[],
    alan: 'netFiyat' | 'komisyonTutari' | 'malKdvTutari' | 'hizmetKdvTutari',
  ): bigint {
    return secimler.reduce((t, s) => t + (s[alan] ?? 0n), 0n);
  }

  private orderNo(): string {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `BNG-${ymd}-${rnd}`;
  }

  // ============================ CHECKOUT ============================
  async checkout(userId: string, dto: CheckoutDto, origin?: string, dikeyBaslik?: string) {
    // Sepet dikeye kilitli: hangi dikeyin sepetiyle odeme yapildigi cozulmeli.
    // Cozulemezse (baslik gondermeyen istemci) gecis kurali: dolu olan en son
    // sepet - bugunku tek-sepet davranisiyla ayni sonucu verir.
    const dikey = dikeyCoz(origin, dikeyBaslik);
    // Varyant da yukleniyor: fiyat/stok/kirilim varyantta tanimliysa oradan
    // okunacak (bkz. common/domain/varyant). Varyantsiz kalemde variant null
    // doner ve tum degerler urunden gelir - Faz 3 oncesiyle ayni sonuc.
    // secimler de yukleniyor: ek ucret ve Carsi kirilimi sepetteki SNAPSHOT'tan
    // okunur (bkz. schema CartItemOption "secim anindaki ek ucret ANLIK KOPYA").
    const sepetIcerik = { items: { include: { product: true, variant: true, secimler: true } } } as const;
    const cart = dikey
      ? await this.prisma.cart.findUnique({
          where: { userId_businessUnit: { userId, businessUnit: dikey } },
          include: sepetIcerik,
        })
      : await this.prisma.cart.findFirst({
          where: { userId, items: { some: {} } },
          orderBy: { updatedAt: 'desc' },
          include: sepetIcerik,
        });
    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Sepet boş');
    }
    if (!cart.storeId) {
      throw new BadRequestException('Sepette mağaza bilgisi yok');
    }

    const store = await this.prisma.store.findFirst({
      where: { id: cart.storeId, isActive: true, deletedAt: null },
      include: { seller: { select: { status: true } } },
    });
    if (!store) throw new BadRequestException('Mağaza aktif değil');

    // SATICI DURUMU: askiya alinan/kapatilan saticinin magazasindan siparis
    // alinmaz. Vitrin suzmesi urunu zaten gizliyor; bu, sepette kalmis eski
    // urunle odemeye gidilmesini kapatan ikinci kapi.
    if (store.seller.status !== SellerStatus.ACTIVE) {
      throw new ConflictException({
        statusCode: 409,
        kod: 'SATICI_AKTIF_DEGIL',
        message: 'Bu mağazanın satıcısı şu anda satışa kapalı.',
        error: 'Conflict',
      });
    }

    // BR-014 — magaza kapaliyken yeni siparis kabul edilmez.
    // store_hours kaydi YOKSA magaza ACIK sayilir (bkz. market.acikMi);
    // aksi halde bu kural devreye girdigi an saat tanimlamamis her magaza
    // kapanirdi.
    if (!(await this.market.acikMi(store.id))) {
      throw new ConflictException({
        statusCode: 409,
        kod: 'MAGAZA_KAPALI',
        message: 'Mağaza şu anda kapalı. Çalışma saatleri içinde tekrar deneyin.',
        error: 'Conflict',
      });
    }

    // Sepetin dikeyi ile magazanin dikeyi ayrisamaz: sepete urun eklerken dikey
    // urunun magazasindan turetiliyor (cart.service). Ayrisiyorsa veri bozuktur,
    // siparis yazilmadan durulur.
    if (cart.businessUnit !== store.businessUnit) {
      throw new ConflictException({
        statusCode: 409,
        kod: 'SEPET_DIKEY_TUTARSIZ',
        message: 'Sepet ile mağaza dikeyi uyuşmuyor. Sepeti temizleyip tekrar deneyin.',
        error: 'Conflict',
      });
    }

    // ORIGIN/DIKEY TUTARLILIGI — para ve stok adimlarindan ONCE, ucuz yoldan.
    // Sepet kullanici basina TEK ve tek magazaya kilitli (Cart.userId @unique +
    // cart.service FARKLI_MAGAZA kurali). Dolayisiyla kullanici bir markanin
    // vitrininde baska markanin sepetiyle odemeye gidebiliyordu: siparis o
    // vitrinle alakasiz bir dikeye yaziliyordu. Burada durduruluyor.
    const originKontrol = checkoutOriginUygun(origin, store.businessUnit);
    if (!originKontrol.uygun) {
      throw new ConflictException({
        statusCode: 409,
        kod: 'YANLIS_DOMAIN',
        message: `Sepetinizdeki ürünler ${originKontrol.beklenenDomain} mağazasına ait. Bu siparişi ${originKontrol.beklenenDomain} adresinden tamamlayın.`,
        beklenenDomain: originKontrol.beklenenDomain,
        error: 'Conflict',
      });
    }

    // Teslimat adresi ZORUNLU. Kontrol burada: cüzdan oluşturma, escrow ve
    // transaction adımlarının hiçbirine girmeden hata dönsün.
    if (!dto.addressId) throw new BadRequestException('Teslimat adresi gerekli');
    const addr = await this.prisma.address.findFirst({ where: { id: dto.addressId, userId } });
    if (!addr) throw new BadRequestException('Adres bulunamadı');
    const addressText = [addr.city, addr.district, addr.line1].filter(Boolean).join(' / ');

    const isCarsi = store.businessUnit === BusinessUnit.CARSI;

    // TESLIMAT BOLGESI KAPISI — para ve stok adimlarindan ONCE, ucuz yoldan.
    //
    // CARSI MUAF: Carsi siparisi BANIGO kuryesiyle degil DicleFul kargosuyla
    // ulke geneline gidiyor (delivery.service: "Carsi siparisi BANIGO Kurye ile
    // tasinmaz"). Ilce kisiti orada anlamsiz olurdu.
    //
    // KISIT YOKSA KAPI CALISMAZ: magazanin hic bolge kaydi yoksa her yere
    // teslimat eder (bkz. market.teslimatBolgesiUygun). Bugun canlida hicbir
    // magazanin kaydi yok, yani bu kapi kimseyi etkilemiyor.
    //
    // UCRET BU TURDA OKUNMUYOR: bolge satirinda feeKurus var ama teslimat
    // ucreti hala DELIVERY_FEE / FREE_DELIVERY_THRESHOLD kuralindan geliyor.
    // Kisit kontrolu ile ucretlendirmeyi ayni pakete koymak, para hesabini
    // dogrulanmamis bir alana baglamak olurdu.
    if (!isCarsi) {
      const bolge = await this.market.teslimatBolgesiUygun(store.id, addr.city, addr.district);
      if (!bolge.uygun) {
        throw new ConflictException({
          statusCode: 409,
          kod: 'TESLIMAT_BOLGESI_DISI',
          message:
            `Bu mağaza teslimat adresinize hizmet vermiyor. ` +
            `Hizmet verilen bölgeler: ${bolge.ilceler.join(', ')}.`,
          // Istemci baska bir adres onerebilsin diye liste GOVDEDE de var:
          // mesaji ayristirmak kirilgan olurdu (bicim degisirse istemci kirilir).
          hizmetVerilenBolgeler: bolge.ilceler,
          error: 'Conflict',
        });
      }
    }

    // Stok + tutar kontrolü (+ Çarşı için gömülü muhasebe kırılımı toplama)
    let subtotal = 0n;
    // Çarşı gömülü kalemleri (ürün fiyatına dahil):
    let carsiKargo = 0n; // DicleFul kargo
    let carsiKom = 0n; // platform komisyonu (%15)
    let carsiHizmetKdv = 0n; // platform hizmet KDV'si
    let carsiMalKdv = 0n; // satıcının KDV'si
    let carsiNet = 0n; // satıcının net malı

    for (const it of cart.items) {
      if (!it.product || !it.product.isActive || it.product.deletedAt) {
        throw new BadRequestException(`Ürün artık satışta değil: ${it.product?.name ?? it.productId}`);
      }
      const stok = etkinStok(it.product, it.variant);
      if (stok < it.quantity) {
        const ad = it.variant ? `${it.product.name} (${it.variant.name})` : it.product.name;
        throw new BadRequestException(`Yetersiz stok: ${ad} (kalan ${stok})`);
      }
      const q = BigInt(it.quantity);
      // SECIM EK UCRETI: sepetteki anlik kopya. Carsi'da urun fiyatinin GUNCEL
      // degerden kurulmasindan bilincli olarak ayrisir - secim satiri snapshot'tir.
      const ekToplam = it.secimler.reduce((t, s) => t + s.ekUcret, 0n);
      if (isCarsi) {
        // Çarşı: kargo + komisyon + KDV ürün fiyatına GÖMÜLÜ.
        // subtotal'ı güncel fiyattan kur (kırılımla birebir uyuşsun).
        // Kırılım kalemleri TEK TEK çözülür: varyantta yalnız fiyat tanımlanıp
        // kırılım boş bırakılabilir; o durumda kırılım üründen gelir ve
        // aşağıdaki "dağıtım == subtotal" güvencesi bozulmaz.
        const k = etkinKirilim(it.product, it.variant);
        subtotal += (k.price + ekToplam) * q;
        // Ek ucretin kirilimi de ayni kovalara akar. KARGOYA EKLEME YOK: kargo
        // gonderi basinadir ve urun fiyatinin icinde zaten var (bkz.
        // pricing.ekUcretHesapla). Ek ucret kargosuz-yuvarlamasiz uretildigi
        // icin net+komisyon+malKdv+hizmetKdv == ekUcret birebir tutar ve
        // asagidaki "dagitim == subtotal" guvencesi bozulmaz.
        carsiKargo += k.kargoTutari * q;
        carsiKom += (k.komisyonTutari + this.secimToplam(it.secimler, 'komisyonTutari')) * q;
        carsiHizmetKdv += (k.hizmetKdvTutari + this.secimToplam(it.secimler, 'hizmetKdvTutari')) * q;
        carsiMalKdv += (k.malKdvTutari + this.secimToplam(it.secimler, 'malKdvTutari')) * q;
        carsiNet += (k.netFiyat + this.secimToplam(it.secimler, 'netFiyat')) * q;
      } else {
        subtotal += (it.unitPrice + ekToplam) * q;
      }
    }

    if (store.minOrder > 0n && subtotal < store.minOrder) {
      throw new BadRequestException(`Minimum sipariş tutarı: ${store.minOrder} kuruş`);
    }

    // ---- Para hesabı ----
    const discount = 0n;
    let deliveryFee: bigint;
    let commission: bigint;
    let vat: bigint;
    let netRevenue: bigint;
    let total: bigint;

    if (isCarsi) {
      // Kargo ürün fiyatına gömülü; AYRI EKLENMEZ (çift kargo önlenir).
      // deliveryFee = gömülü kargo (teslimatta DicleFul'e yönlendirilir).
      deliveryFee = carsiKargo;
      commission = carsiKom; // platform komisyonu (gömülü %15)
      vat = carsiHizmetKdv; // platform hizmet KDV'si
      netRevenue = carsiNet + carsiMalKdv; // satıcının eline geçen (mal + mal KDV)
      total = subtotal; // kargo zaten subtotal içinde -> ek YOK
      // Tutarlılık güvencesi: dağıtım kalemleri subtotal'a birebir oturmalı
      const dagitim = netRevenue + commission + vat + deliveryFee;
      if (dagitim !== subtotal) {
        throw new BadRequestException(
          `Çarşı tutar tutarsızlığı: dağıtım ${dagitim} ≠ subtotal ${subtotal}`,
        );
      }
    } else {
      deliveryFee = subtotal >= FREE_DELIVERY_THRESHOLD ? 0n : DELIVERY_FEE;
      commission = (subtotal * BigInt(store.commissionRate)) / 10000n; // binde -> /10000
      vat = (commission * VAT_INCLUDED_RATE) / (100n + VAT_INCLUDED_RATE); // KDV dahil pay
      netRevenue = subtotal - commission;
      total = subtotal + deliveryFee - discount;
    }

    // Müşteri bakiyesi ön kontrol (net mesaj için)
    const customerWallet = await this.wallet.getOrCreateUserWallet(userId);
    if (customerWallet.balance < total) {
      throw new BadRequestException('Yetersiz bakiye. Lütfen cüzdana para yükleyin.');
    }
    const escrowWallet = await this.wallet.getSystemWallet(WalletType.ESCROW);

    const orderNo = this.orderNo();
    // Transaction DIŞINDA üretilir: değeri SMS için transaction sonrasında da lazım.
    const teslimKod = this.teslimKoduUret();

    // Hepsi tek transaction'da: stok düş + sipariş yarat + escrow'a al + sepeti temizle
    const order = await this.prisma.$transaction(async (tx) => {
      // STOK DUSUMU: varyantli kalemde varyantin stogu duser, varyantsizda
      // urunun. Varyantta stock NULL ise stok urun duzeyinde tutuluyor demektir
      // (etkinStok orada urune dusuyordu), dolayisiyla dusum de urunden yapilir.
      //
      // DUSUM KOSULLU — CHECK-THEN-ACT YARISI BURADA KAPANIR.
      //
      // Yukaridaki yeterlilik kontrolu (etkinStok < quantity) transaction'in
      // DISINDA, sepet okunurken yapiliyor. Dusum kosulsuz oldugu surece iki
      // musteri ayni anda kontrolden gecip ikisi de dusum yapabiliyordu:
      // yerelde uretildi - stok 1 iken iki eszamanli checkout, iki 201, stok
      // -1 ve IKI cuzdandan tahsilat. Kosul (stock >= quantity) UPDATE'in
      // kendisine tasindi: Postgres satir kilidi altinda degerlendirdigi icin
      // ikinci istek 0 satir gunceller ve buradan geri doner.
      //
      // DESEN EV DESENI: finance/services/ledger.service ayni sinifi ayni
      // sekilde cozuyor ("atomik yaz, sonra dogrula, ihlalde transaction'i
      // geri sar" - bakiye eksiye duserse ConflictException). cancel() de
      // durum gecisini kosullu updateMany + count===0 ile koruyor.
      //
      // TRANSACTION'IN TAMAMI GERI SARILIR: siparis, escrow'a alma, teslimat
      // kaydi ve sepet temizligi bu throw'un ARDINDAN gelen adimlar oldugu
      // icin hicbiri yazilmaz. Yani "parasi cekilmis ama urunu olmayan
      // musteri" durumu dogmaz ve SEPET DE DURUR (musteri kalemi cikarip
      // tekrar deneyebilir).
      for (const it of cart.items) {
        const varyantStogu =
          !!it.variantId && it.variant?.stock !== null && it.variant?.stock !== undefined;
        const { count } = varyantStogu
          ? await tx.productVariant.updateMany({
              where: { id: it.variantId as string, stock: { gte: it.quantity } },
              data: { stock: { decrement: it.quantity } },
            })
          : await tx.product.updateMany({
              where: { id: it.productId, stock: { gte: it.quantity } },
              data: { stock: { decrement: it.quantity } },
            });
        if (count === 0) {
          // TUM SIPARIS DURUR, kalem ATLANMAZ: siparis sepetin tamamindan tek
          // parca olarak kuruluyor (toplam, komisyon, Carsi kirilimi ve escrow
          // tutari transaction'a girmeden ONCE hesaplandi). Bir kalemi burada
          // dusurmek o hesaplarin hepsini gecersiz kilardi; ustelik musteri
          // onaylamadigi bir sepet icin odeme yapmis olurdu.
          const ad = it.variant ? `${it.product?.name} (${it.variant.name})` : it.product?.name;
          throw new ConflictException({
            statusCode: 409,
            kod: 'STOK_TUKENDI',
            message: `Ürün tükendi: ${ad}. Sepetinizden çıkarıp tekrar deneyebilirsiniz.`,
            urunId: it.productId,
            variantId: it.variantId ?? null,
            error: 'Conflict',
          });
        }
      }

      const created = await tx.order.create({
        data: {
          orderNo,
          userId,
          storeId: store.id,
          businessUnit: store.businessUnit,
          status: OrderStatus.CONFIRMED,
          paymentStatus: PaymentStatus.PAID,
          subtotal,
          deliveryFee,
          discount,
          total,
          commission,
          vat,
          netRevenue,
          addressId: dto.addressId,
          addressText,
          note: dto.note,
          contactPhone: dto.contactPhone,
          confirmedAt: new Date(),
          items: {
            create: cart.items.map((it) => {
              // Çarşı'da OrderItem fiyatı güncel fiyat (kırılımla uyumlu);
              // varyant varsa onun fiyatı geçerli.
              const taban = isCarsi ? etkinKirilim(it.product, it.variant).price : it.unitPrice;
              // OrderItem.unitPrice EK UCRETI ICERIR (CartItem.unitPrice'tan
              // farkli olarak). Sart: semadaki "lineTotal = unitPrice * quantity"
              // ve "subtotal = Σ lineTotal" invariantlari ancak boyle korunur.
              // Ek ucretin ad/tutar dokumu secimler'de duruyor.
              const up = taban + it.secimler.reduce((t, s) => t + s.ekUcret, 0n);
              return {
                productId: it.productId,
                name: it.product.name,
                // SNAPSHOT: varyant adı kopyalanır; variantId'ye FK yok, varyant
                // sonradan silinse de geçmiş sipariş okunabilir kalır.
                variantId: it.variantId,
                variantAdi: it.variant?.name ?? null,
                unitType: it.product.unitType,
                unitPrice: up,
                quantity: it.quantity,
                lineTotal: up * BigInt(it.quantity),
                // SECIM SNAPSHOT'i — ayni gerekce: optionId'ye FK yok, secenek
                // silinse de gecmis siparis satiri kendi basina okunabilir kalir.
                ...(it.secimler.length > 0
                  ? {
                      secimler: {
                        create: it.secimler.map((s) => ({
                          optionId: s.optionId,
                          optionAdi: s.optionAdi,
                          ekUcret: s.ekUcret,
                        })),
                      },
                    }
                  : {}),
              };
            }),
          },
        },
        include: { items: { include: { secimler: true } } },
      });

      // Escrow'a al: müşteri -total, escrow +total
      await this.ledger.postWithTx(tx, {
        type: TransactionType.PAYMENT,
        reference: orderNo,
        orderNo,
        businessUnit: store.businessUnit,
        commission,
        vat,
        deliveryFee,
        netRevenue,
        description: `Sipariş ${orderNo} ödemesi (escrow)`,
        lines: [
          { walletId: customerWallet.id, direction: EntryDirection.DEBIT, amount: total },
          { walletId: escrowWallet.id, direction: EntryDirection.CREDIT, amount: total },
        ],
      });

      // Teslimat kaydı (havuzda bekliyor). Çarşı = DicleFul kargo havuzu.
      // Teslim kodu SİPARİŞ ONAYLANIRKEN üretilir: müşteri kodu sipariş ekranından
      // görür, kurye teslimatta bu kodu ister (bkz. delivery.service.deliver).
      await tx.delivery.create({
        data: { orderId: created.id, fee: deliveryFee, status: DeliveryStatus.PENDING, teslimKod },
      });

      // Sepeti temizle
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({ where: { id: cart.id }, data: { storeId: null } });

      return created;
    });

    // İKİNCİL KANAL — SMS. Transaction'ın DIŞINDA: sipariş ve para hareketi
    // bildirime bağlı olmamalı. BildirimService hatayı zaten yutup kayda geçiyor.
    // Telefonu olmayan (misafir) siparişte tek kanal sipariş ekranıdır.
    if (order.contactPhone) {
      await this.bildirim.gonderSms(order.contactPhone, 'TESLIM_KODU', {
        orderNo: order.orderNo,
        kod: teslimKod,
      });
    }

    return order;
  }

  // ============================ LİSTELEME ============================
  async myOrders(userId: string, skip = 0, take = 20) {
    return this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Math.min(take, 100),
      // Teslim kodu BU uçta dönebilir: where zaten userId'ye kilitli, yani
      // yalnızca siparişin sahibi kendi kodunu görür. Müşteri ekranının kodu
      // gösterebildiği birincil kanal burasıdır.
      include: {
        // SECIMLER DE DONER: "ekstra peynir" siparisin ne oldugunun parcasidir;
        // musteri de satici da satirin kendisinde gorur.
        items: { include: { secimler: true } },
        store: { select: { name: true } },
        delivery: { select: { status: true, teslimKod: true, teslimKodDogrulandiAt: true } },
      },
    });
  }

  async getOne(user: AuthUser, id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { secimler: true } },
        store: true,
        delivery: { select: { status: true, teslimKod: true, teslimKodDogrulandiAt: true } },
      },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');
    const isOwner = order.userId === user.id;
    // Magaza tarafi: sahip, AKTIF personel ya da platform yoneticisi (tek kaynak:
    // market.service.erisebilir). Magaza zaten okundu, tekrar sorgu acilmiyor.
    const magazaYetkisi = await this.market.erisebilir(order.store, user.id, user.roles ?? []);
    if (!isOwner && !magazaYetkisi) {
      throw new ForbiddenException('Bu siparişi görme yetkiniz yok');
    }
    // Teslim kodunu YALNIZCA sipariş sahibi görür. Bu uç satıcıya ve süper admine
    // de açık; kod oralara sızarsa teslimat müşteriye sorulmadan kapatılabilirdi.
    if (!isOwner && order.delivery) {
      return { ...order, delivery: { ...order.delivery, teslimKod: undefined } };
    }
    return order;
  }

  async storeOrders(user: AuthUser, storeId: string, status?: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Mağaza bulunamadı');
    if (!(await this.market.erisebilir(store, user.id, user.roles ?? []))) {
      throw new ForbiddenException('Bu mağazanın siparişlerini görme yetkiniz yok');
    }
    const where: Prisma.OrderWhereInput = { storeId };
    if (status && (OrderStatus as any)[status]) {
      where.status = status as OrderStatus;
    }
    return this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      // Satici ekrani: hazirlanacak secimler satirda gorunmeli.
      include: { items: { include: { secimler: true } } },
    });
  }

  // ============================ DURUM İLERLETME ============================
  async updateStatus(user: AuthUser, id: string, next: OrderStatus) {
    // Guard okuması, koşullu yazma ve dönüş okuması ARTIK TEK TRANSACTION içinde.
    //
    // Doğruluğu sağlayan hâlâ koşullu yazım (E-1): `where: { id, status: order.status }`
    // tam olarak guard'ın onayladığı geçişi çivilediği için, okuma bayat olsa bile
    // GEÇERSİZ bir geçiş yazılamıyordu. Transaction'ın eklediği şey ayrı:
    //
    //   Yazımdan sonraki okuma artık TUTARLI. Transaction dışında updateMany kendi örtük
    //   transaction'ında commit edip satır kilidini bırakıyordu; hemen ardından gelen
    //   findUnique, araya giren başka bir yolun (ör. kurye claim+pickup) yazdığı DAHA YENİ
    //   durumu okuyabiliyordu. Yani satıcı READY'ye geçirip yanıtta ON_THE_WAY görebiliyordu.
    //   Transaction içinde kilit commit'e kadar bizde kalır; dönen kayıt yazdığımızın aynısıdır.
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { store: true },
      });
      if (!order) throw new NotFoundException('Sipariş bulunamadı');
      // Uyelik okumasi transaction DISINDAKI istemciyle yapiliyor: yaris konusu
      // olan sey siparis durumu, personel listesi degil.
      if (!(await this.market.erisebilir(order.store, user.id, user.roles ?? []))) {
        throw new ForbiddenException('Bu siparişi yönetme yetkiniz yok');
      }

      const allowed = this.orderStatus.NEXT_STATUS[order.status] ?? [];
      if (!allowed.includes(next)) {
        throw new ConflictException(`Geçersiz durum geçişi: ${order.status} -> ${next}`);
      }

      const { count } = await tx.order.updateMany({
        where: { id, status: order.status },
        data: { status: next },
      });
      if (count === 0) {
        const guncel = await tx.order.findUnique({
          where: { id },
          select: { status: true },
        });
        throw new ConflictException(
          `Sipariş bu sırada başka bir yoldan güncellendi (okunan: ${order.status}, güncel: ${guncel?.status ?? 'bulunamadı'})`,
        );
      }

      return tx.order.findUnique({ where: { id }, include: { items: { include: { secimler: true } } } });
    });
  }

  // ============================ İPTAL / İADE ============================
  async cancel(user: AuthUser, id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { store: true, items: true },
    });
    if (!order) throw new NotFoundException('Sipariş bulunamadı');

    const isOwner = order.userId === user.id;
    const magazaYetkisi = await this.market.erisebilir(order.store, user.id, user.roles ?? []);
    if (!isOwner && !magazaYetkisi) {
      throw new ForbiddenException('Bu siparişi iptal etme yetkiniz yok');
    }
    // Erken ret: cüzdan sorguları ve transaction açılmadan, ucuz yoldan.
    // Bağlayıcı kontrol bu DEĞİL — transaction içindeki guard + koşullu yazım.
    if (!this.orderStatus.CANCELABLE.includes(order.status)) {
      throw new ConflictException(`Bu durumda iptal edilemez: ${order.status}`);
    }

    // Bu üç veri checkout'ta yazılıp bir daha değişmiyor (items, total, userId), o yüzden
    // transaction dışında okunmaları bayatlık yaratmaz; cüzdanlar da transaction'ı uzatmamak
    // için önceden çözülüyor.
    const escrow = await this.wallet.getSystemWallet(WalletType.ESCROW);
    const customerWallet = await this.wallet.getOrCreateUserWallet(order.userId);

    return this.prisma.$transaction(async (tx) => {
      // PARA KAPISI — transaction'ın İLK işlemi olmalı.
      // Yukarıdaki CANCELABLE kontrolü transaction DIŞINDA okunmuş duruma bakıyordu; araya
      // kurye girip siparişi ON_THE_WAY/DELIVERED yapmış olabilir. Koşulsuz yazımda iptal
      // yine de geçiyor ve escrow'dan aynı para İKİ KEZ çıkıyordu (teslimatta :settle ile
      // dağıtım + burada :refund ile iade; farklı reference oldukları için ledger'ın
      // idempotency kontrolü bunu yakalamaz).
      // En başta olması ayrıca fail-fast sağlar: ürün satırlarına gereksiz kilit alınmaz.
      //
      // Guard transaction İÇİNDE tekrarlanıyor: dış kontrolün bayat kalması hâlinde hata
      // mesajı gerçek duruma göre üretilsin ve iptal kararı yazımla aynı bağlamda alınsın.
      const iceriden = await tx.order.findUnique({ where: { id }, select: { status: true } });
      if (!iceriden) throw new NotFoundException('Sipariş bulunamadı');
      if (!this.orderStatus.CANCELABLE.includes(iceriden.status)) {
        throw new ConflictException(
          `Bu durumda iptal edilemez: ${iceriden.status} (sipariş bu sırada başka bir yoldan güncellendi)`,
        );
      }

      const { count } = await tx.order.updateMany({
        where: { id, status: { in: this.orderStatus.CANCELABLE } },
        data: { status: OrderStatus.CANCELLED, paymentStatus: PaymentStatus.REFUNDED, cancelledAt: new Date() },
      });
      if (count === 0) {
        const guncel = await tx.order.findUnique({
          where: { id },
          select: { status: true },
        });
        throw new ConflictException(
          `Bu durumda iptal edilemez: ${guncel?.status ?? 'bulunamadı'} (sipariş bu sırada başka bir yoldan güncellendi)`,
        );
      }

      // Stok geri yükle — DÜŞÜMÜN AYNASI olmalı: stok hangi kayıttan düştüyse
      // oraya geri gider. variantId dolu olan satırda düşüm varyanttan yapılmış
      // olabilir; varyantın stock'u NULL ise düşüm üründen yapılmıştır, iade de
      // öyle olur. Aynası tutmazsa stok sessizce şişer ya da kaybolur.
      for (const it of order.items) {
        const varyant = it.variantId
          ? await tx.productVariant.findUnique({ where: { id: it.variantId }, select: { stock: true } })
          : null;
        if (it.variantId && varyant && varyant.stock !== null) {
          await tx.productVariant.update({
            where: { id: it.variantId },
            data: { stock: { increment: it.quantity } },
          });
        } else {
          await tx.product.update({
            where: { id: it.productId },
            data: { stock: { increment: it.quantity } },
          });
        }
      }

      // Teslimat kaydını iptal et (varsa)
      await tx.delivery.updateMany({
        where: { orderId: id },
        data: { status: DeliveryStatus.CANCELLED },
      });

      // İade: escrow -total, müşteri +total
      await this.ledger.postWithTx(tx, {
        type: TransactionType.REFUND,
        reference: `${order.orderNo}:refund`,
        orderNo: order.orderNo,
        businessUnit: order.businessUnit,
        description: `Sipariş ${order.orderNo} iptal/iade`,
        lines: [
          { walletId: escrow.id, direction: EntryDirection.DEBIT, amount: order.total },
          { walletId: customerWallet.id, direction: EntryDirection.CREDIT, amount: order.total },
        ],
      });

      return tx.order.findUnique({ where: { id }, include: { items: { include: { secimler: true } } } });
    });
  }
}
