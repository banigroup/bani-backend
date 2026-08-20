import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BusinessUnit, SellerStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { etkinFiyat } from '../common/domain/varyant';
import { ekUcretHesapla } from '../delivery/pricing';
import { AddItemDto } from './dto/add-item.dto';

// Sepet kalemine yazilacak secim satiri. Kirilim alanlari YALNIZCA Carsi'da
// dolar (bkz. secimleriCoz); Carsi disinda undefined kalir ve kolonlar NULL olur.
type SecimSatiri = {
  optionId: string;
  optionAdi: string;
  ekUcret: bigint;
  netFiyat?: bigint;
  komisyonTutari?: bigint;
  malKdvTutari?: bigint;
  hizmetKdvTutari?: bigint;
};

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * YAZMA yolu: dikey kesin oldugunda sepeti bulur, yoksa yaratir.
   * upsert kullaniliyor - eski findUnique+create ikilisi es zamanli iki istekte
   * bilesik unique'i ihlal edip P2002 atabilirdi.
   */
  private async getOrCreate(userId: string, dikey: BusinessUnit) {
    return this.prisma.cart.upsert({
      where: { userId_businessUnit: { userId, businessUnit: dikey } },
      create: { userId, businessUnit: dikey },
      update: {},
    });
  }

  /**
   * OKUMA yolu: sepeti bulur, YARATMAZ (bos GET her ziyaretcide cop satir
   * uretmesin - canlida boyle birikmis 20 bos sepet var).
   *
   * GECIS KURALI: dikey cozulemediyse (ana domainden gelen, X-Bani-Dikey
   * basligini henuz gondermeyen istemci) en son dokunulan sepet doner - yani
   * bugunku tek-sepet davranisi. Istemci basligi gondermeye basladiginda bu
   * dal olulesir ve kaldirilabilir.
   */
  private async sepetBul(userId: string, dikey: BusinessUnit | null) {
    if (dikey) {
      return this.prisma.cart.findUnique({
        where: { userId_businessUnit: { userId, businessUnit: dikey } },
      });
    }
    return this.prisma.cart.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } });
  }

  /**
   * SECIM DOGRULAMA + FIYATLANDIRMA — TEK YER.
   *
   * Dondurdugu satirlar dogrudan CartItemOption'a yazilir. Iki isi birlikte
   * yapiyor cunku ikisi de AYNI okumaya dayaniyor (urunun bagli oldugu gruplar
   * ve onlarin aktif secenekleri); ayirmak ayni sorguyu iki kez actirirdi.
   *
   * CARSI'DA EK UCRET DE TAM FIYAT HATTINDAN GECER: Option.ekUcret saticinin
   * NET beklentisidir, musteriye komisyon + mal KDV + hizmet KDV eklenmis hali
   * yansir ve kirilim secim satirinda saklanir (checkout onu siparis
   * basligindaki commission/vat/netRevenue toplamlarina ekler). Carsi disinda
   * ekUcret dogrudan satis tutaridir, kirilim NULL kalir - urun/varyant
   * tarafindaki desenin aynisi.
   */
  private async secimleriCoz(
    urun: { id: string; kdvOrani: number },
    magaza: { businessUnit: BusinessUnit; commissionRate: number },
    optionIds?: string[],
  ): Promise<SecimSatiri[]> {
    // TEKILLESTIRME: ayni secenek iki kez gelirse tek sayilir. Reddetmek yerine
    // sadelestiriliyor - hem grup sayimlari dogru cikar hem de
    // @@unique([cartItemId, optionId]) P2002'ye dusmez.
    const secilen = [...new Set(optionIds ?? [])];

    // Secim GELMESE DE okunur: zorunlu grubun bos birakildigi burada anlasilir.
    const bagli = await this.prisma.productOptionGroup.findMany({
      where: { productId: urun.id, group: { isActive: true } },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            minSecim: true,
            maxSecim: true,
            zorunlu: true,
            options: { where: { isActive: true }, select: { id: true, name: true, ekUcret: true } },
          },
        },
      },
    });

    // optionId -> secenek haritasi. Haritada olmayan kimlik ya baska urunun/
    // magazanin secenegi ya da pasif; ikisi de reddedilir. Varyant tarafindaki
    // gerekcenin aynisi: aksi halde istemci baska bir secenegin kimligini
    // gonderip ek ucreti karistirabilirdi.
    const harita = new Map<string, { ad: string; ekUcret: bigint; grupId: string }>();
    for (const b of bagli) {
      for (const o of b.group.options) {
        harita.set(o.id, { ad: o.name, ekUcret: o.ekUcret, grupId: b.group.id });
      }
    }

    const grupSayim = new Map<string, number>();
    for (const id of secilen) {
      const s = harita.get(id);
      if (!s) throw new BadRequestException('Seçenek bu ürüne ait değil veya pasif');
      grupSayim.set(s.grupId, (grupSayim.get(s.grupId) ?? 0) + 1);
    }

    for (const b of bagli) {
      const g = b.group;
      const n = grupSayim.get(g.id) ?? 0;
      // ZORUNLU AYRI KONTROL EDILIYOR: yazma ucu zorunlu grupta minSecim>=1
      // sartini koyuyor (catalog.secimSiniriDogrula) ama eski kayitlarda
      // zorunlu:true + minSecim:0 bulunabilir; o bosluk burada kapaniyor.
      if (g.zorunlu && n === 0) {
        throw new BadRequestException(`"${g.name}" seçimi zorunlu`);
      }
      // minSecim yalnizca gruba DOKUNULDUYSA aranir. Zorunlu olmayan bir grupta
      // min>1 tanimlanmis olabilir ("sos seciyorsan en az 2 sec"); her durumda
      // dayatmak grubu zorunlu yapardi ve zorunlu:false ile celisirdi.
      if (n > 0 && n < g.minSecim) {
        throw new BadRequestException(`"${g.name}" grubundan en az ${g.minSecim} seçim yapmalısınız`);
      }
      if (n > g.maxSecim) {
        throw new BadRequestException(`"${g.name}" grubundan en fazla ${g.maxSecim} seçim yapabilirsiniz`);
      }
    }

    const komisyonOran = BigInt(magaza.commissionRate) / 100n;
    return secilen.map((id) => {
      const s = harita.get(id)!;
      if (magaza.businessUnit !== BusinessUnit.CARSI) {
        return { optionId: id, optionAdi: s.ad, ekUcret: s.ekUcret };
      }
      const h = ekUcretHesapla(s.ekUcret, urun.kdvOrani, komisyonOran);
      return {
        optionId: id,
        optionAdi: s.ad,
        ekUcret: h.vitrinKurus,
        netFiyat: h.netKurus,
        komisyonTutari: h.komisyonKurus,
        malKdvTutari: h.malKdvKurus,
        hizmetKdvTutari: h.hizmetKdvKurus,
      };
    });
  }

  async view(userId: string, dikey: BusinessUnit | null) {
    const cart = await this.sepetBul(userId, dikey);
    if (!cart) {
      return {
        cartId: null,
        businessUnit: dikey,
        storeId: null,
        store: null,
        itemCount: 0,
        subtotal: 0n,
        items: [],
      };
    }
    const items = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      orderBy: { createdAt: 'asc' },
      include: {
        product: {
          select: {
            id: true, name: true, imageUrl: true, price: true, stock: true, isActive: true,
            unitType: true, storeId: true,
            store: { select: { id: true, name: true, slug: true } },
          },
        },
        variant: { select: { id: true, name: true } },
        // Kirilim kolonlari BILEREK okunmuyor: musteri gorunumu ek ucretin
        // toplamini gosterir, komisyon/KDV ayrismasini degil.
        secimler: {
          orderBy: { createdAt: 'asc' },
          select: { optionId: true, optionAdi: true, ekUcret: true },
        },
      },
    });

    let subtotal = 0n;
    const lines = items.map((it) => {
      // unitPrice TABAN birim fiyattir (anlami degismedi); ek ucret tek kaynakta
      // - secim satirlarinda - durur ve okuma aninda toplanir. Boylece cift
      // sayim mumkun degil.
      const ekUcretToplam = it.secimler.reduce((t, s) => t + s.ekUcret, 0n);
      const satirBirimFiyat = it.unitPrice + ekUcretToplam;
      const lineTotal = satirBirimFiyat * BigInt(it.quantity);
      subtotal += lineTotal;
      return {
        id: it.id,
        productId: it.productId,
        name: it.product.name,
        imageUrl: it.product.imageUrl,
        // Varyantsiz kalemde ikisi de null -> istemci gorunumunde degisiklik yok.
        variantId: it.variantId,
        variantAdi: it.variant?.name ?? null,
        // "5" neyin 5'i: adet mi gram mi. Tartili urunde istemci bunu
        // "0,75 kg" gibi gostermek icin kullanir.
        unitType: it.product.unitType,
        unitPrice: it.unitPrice,
        // Secimsiz kalemde secimler bos, ekUcretToplam 0 ve satirBirimFiyat
        // unitPrice'a esittir -> istemci gorunumu Faz 3 oncesiyle birebir ayni.
        secimler: it.secimler,
        ekUcretToplam,
        satirBirimFiyat,
        quantity: it.quantity,
        lineTotal,
        // Tek-magaza kurali: gorunurluk icin kalem duzeyinde magaza bilgisi
        storeId: it.product.storeId,
        storeName: it.product.store.name,
        storeSlug: it.product.store.slug,
      };
    });

    // Sepet duzeyinde magaza (tek-magaza kurali geregi tum kalemler ayni magazadan)
    const first = items[0];
    const store = first
      ? { id: first.product.store.id, name: first.product.store.name, slug: first.product.store.slug }
      : null;

    return {
      cartId: cart.id,
      businessUnit: cart.businessUnit,
      storeId: cart.storeId,
      store,
      itemCount: lines.reduce((n, l) => n + l.quantity, 0),
      subtotal,
      items: lines,
    };
  }

  async addItem(userId: string, dto: AddItemDto) {
    // DIKEY URUNDEN TURETILIR, istemciden gelen basliktan DEGIL: boylece baslikla
    // oynayarak bir urunu baska dikeyin sepetine yazmak mumkun olmaz.
    const product = await this.prisma.product.findFirst({
      // Satici ACTIVE degilse urun sepete de eklenemez (vitrin suzmesiyle ayni kural).
      where: { id: dto.productId, deletedAt: null, isActive: true, store: { seller: { status: SellerStatus.ACTIVE } } },
      // commissionRate: Carsi'da secenek ek ucretinin komisyonu magazanin
      // merkezi oranindan hesaplanir (katalog tarafiyla ayni kaynak).
      include: { store: { select: { businessUnit: true, commissionRate: true } } },
    });
    if (!product) throw new NotFoundException('Ürün bulunamadı veya pasif');

    // VARYANT DOGRULAMA: varyantin O URUNE ait ve aktif olmasi sart. Aksi halde
    // istemci baska bir urunun varyant kimligini gonderip fiyat karistirabilirdi.
    const variant = dto.variantId
      ? await this.prisma.productVariant.findFirst({
          where: { id: dto.variantId, productId: product.id, isActive: true, deletedAt: null },
        })
      : null;
    if (dto.variantId && !variant) {
      throw new NotFoundException('Ürün varyantı bulunamadı veya pasif');
    }
    // Varyantsizda etkinFiyat urunun fiyatini dondurur -> davranis degismez.
    const birimFiyat = etkinFiyat(product, variant);

    // SECIMLER: dogrulama + fiyatlandirma. Sepete/magazaya dokunmadan ONCE
    // cagriliyor - gecersiz secimde bos sepet yaratilmasin, storeId bayatlamasin.
    const secimler = await this.secimleriCoz(product, product.store, dto.optionIds);

    const cart = await this.getOrCreate(userId, product.store.businessUnit);
    const qty = dto.quantity ?? 1;

    // Tek-mağaza kuralı: sepette ürün varken başka mağazanın ürünü eklenemez
    const itemCount = await this.prisma.cartItem.count({ where: { cartId: cart.id } });
    if (itemCount > 0 && cart.storeId && cart.storeId !== product.storeId) {
      throw new ConflictException({
        statusCode: 409,
        kod: 'FARKLI_MAGAZA',
        message: 'Sepetinizde başka bir mağazadan ürün var.',
        error: 'Conflict',
      });
    }
    // Sepet boşsa veya mağazasızsa mağazayı bu ürüne bağla (bayat storeId'yi de düzeltir)
    if (cart.storeId !== product.storeId) {
      await this.prisma.cart.update({ where: { id: cart.id }, data: { storeId: product.storeId } });
    }

    // TEKILLIK ARTIK SECIM KUMESINI DE KAPSIYOR (Faz 3 / adim 3 karari):
    // ayni urun+varyant, FARKLI SECIM = AYRI KALEM. Secimler ayri tabloda
    // durdugu icin bu SQL'de ifade edilemez; eski
    // @@unique([cartId, productId, variantId]) tam da ikinci kalemi reddettigi
    // icin dusuruldu ve tekillik tumuyle buraya, uygulamaya tasindi.
    //
    // Once urun+varyant adaylari okunur (findFirst ile tek satir yerine
    // findMany: artik birden cok esit-ihtimalli satir olabilir), sonra secim
    // kumesi bellekte karsilastirilir. Kumeler kucuk (bir kalemde birkac secim),
    // aday sayisi da oyle - karsilastirmanin maliyeti ihmal edilebilir.
    const secimKimlikleri = new Set(secimler.map((s) => s.optionId));
    const adaylar = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id, productId: product.id, variantId: variant?.id ?? null },
      include: { secimler: { select: { optionId: true } } },
    });
    const existing = adaylar.find(
      (a) =>
        a.secimler.length === secimKimlikleri.size &&
        a.secimler.every((s) => secimKimlikleri.has(s.optionId)),
    );

    if (existing) {
      // Secimler AYNI oldugu icin dokunulmuyor; yalnizca miktar ve guncel fiyat.
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + qty, unitPrice: birimFiyat },
      });
    } else {
      // Kalem ve secimleri TEK create'te: yarim kalem (secimsiz yazilmis ama
      // secimli olmasi gereken satir) kalamaz.
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: product.id,
          variantId: variant?.id ?? null,
          quantity: qty,
          unitPrice: birimFiyat,
          ...(secimler.length > 0 ? { secimler: { create: secimler } } : {}),
        },
      });
    }

    return this.view(userId, cart.businessUnit);
  }

  /**
   * Kalem duzeyi islemlerde dikeye ihtiyac YOK: kalem zaten bir sepete bagli,
   * sepet de bir kullaniciya. Sahiplik dogrudan o zincirden dogrulanir.
   */
  private async kalemBul(userId: string, itemId: string) {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: itemId },
      include: { cart: { select: { userId: true, businessUnit: true } } },
    });
    if (!item || item.cart.userId !== userId) {
      throw new NotFoundException('Sepet kalemi bulunamadı');
    }
    return item;
  }

  async updateItem(userId: string, itemId: string, quantity: number) {
    const item = await this.kalemBul(userId, itemId);

    if (quantity <= 0) {
      await this.prisma.cartItem.delete({ where: { id: itemId } });
    } else {
      await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
    }
    return this.view(userId, item.cart.businessUnit);
  }

  async removeItem(userId: string, itemId: string) {
    const item = await this.kalemBul(userId, itemId);
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.view(userId, item.cart.businessUnit);
  }

  async clear(userId: string, dikey: BusinessUnit | null) {
    const cart = await this.sepetBul(userId, dikey);
    if (!cart) return this.view(userId, dikey);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await this.prisma.cart.update({ where: { id: cart.id }, data: { storeId: null } });
    return this.view(userId, cart.businessUnit);
  }
}
