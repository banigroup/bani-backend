import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BusinessUnit, SellerStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { etkinFiyat } from '../common/domain/varyant';
import { AddItemDto } from './dto/add-item.dto';

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
      },
    });

    let subtotal = 0n;
    const lines = items.map((it) => {
      const lineTotal = it.unitPrice * BigInt(it.quantity);
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
      include: { store: { select: { businessUnit: true } } },
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

    // VARYANTSIZ SATIR ARAMASI findFirst ILE: bilesik unique artik variantId'yi
    // de kapsiyor (@@unique([cartId, productId, variantId])) ve Postgres'te
    // NULL != NULL oldugu icin findUnique bu anahtarla null kabul etmez.
    // Tekillik korumasi burada, uygulamada: ayni urun+varyant zaten varsa
    // miktari artiriliyor. Farkli varyantlar AYRI KALEM olur.
    const existing = await this.prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId: product.id, variantId: variant?.id ?? null },
    });

    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + qty, unitPrice: birimFiyat },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: product.id,
          variantId: variant?.id ?? null,
          quantity: qty,
          unitPrice: birimFiyat,
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
