import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role, SellerStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MarketService } from '../market/market.service';
import { slugify, randomSuffix } from '../common/util/slug';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { vitrinFiyatHesapla, kdvOraniBul } from '../delivery/pricing';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly market: MarketService,
  ) { }

  // ---- Kategoriler ----
  // GORUNURLUK STOKTAN TURER: bir baslik, kendi urunu veya alt basliginin urunu
  // stokta ise vitrinde listelenir. isActive ise "yonetici bilerek kapatti" demektir;
  // ikisi ayri kavramdir, karistirilmaz.
  // tumu=true -> yonetim ekranlari icin: bos kategoriler de doner (urun atamak icin gerekli).
  async listCategories(storeId: string, tumu = false) {
    // "Dolu" urun: kendi stogu varsa YA DA stoklu bir varyanti varsa.
    // Varyantsiz urunde ikinci dal hicbir zaman saglanmaz -> sonuc Faz 3
    // oncesiyle birebir ayni (kanit: yerel testte kategori sayilari degismedi).
    const dolu = {
      isActive: true,
      deletedAt: null,
      OR: [
        { stock: { gt: 0 } },
        { varyantlar: { some: { isActive: true, deletedAt: null, stock: { gt: 0 } } } },
      ],
    };
    const kayitlar = await this.prisma.category.findMany({
      where: {
        storeId,
        isActive: true,
        ...(tumu ? {} : {
          OR: [
            { products: { some: dolu } },
            { children: { some: { isActive: true, products: { some: dolu } } } },
          ],
        }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: { where: dolu } } } },
    });

    // Iki seviyeli agac. Ebeveyni listede olmayan cocuk ust seviyeye cikar
    // (ebeveyn kapaliysa cocugun urunleri kaybolmasin).
    const dugumler = new Map<string, any>();
    for (const c of kayitlar) {
      const { _count, ...alanlar } = c;
      dugumler.set(c.id, { ...alanlar, urunSayisi: _count.products, children: [] });
    }
    const kokler: any[] = [];
    for (const c of kayitlar) {
      const dugum = dugumler.get(c.id);
      const ebeveyn = c.parentId ? dugumler.get(c.parentId) : undefined;
      if (ebeveyn) ebeveyn.children.push(dugum);
      else kokler.push(dugum);
    }
    for (const d of dugumler.values()) {
      d.toplamUrun = d.urunSayisi + d.children.reduce((n: number, c: any) => n + c.urunSayisi, 0);
    }
    return kokler;
  }

  async createCategory(storeId: string, userId: string, roles: Role[], dto: CreateCategoryDto) {
    await this.market.assertOwner(storeId, userId, roles);

    // En fazla IKI seviye: secilen ebeveyn kendisi bir alt kategoriyse reddet.
    // Ebeveyn ayni magazadan olmali (baska magazanin agacina baglanamaz).
    if (dto.parentId) {
      const ebeveyn = await this.prisma.category.findFirst({
        where: { id: dto.parentId, storeId },
        select: { parentId: true },
      });
      if (!ebeveyn) throw new BadRequestException('Ust kategori bulunamadi');
      if (ebeveyn.parentId) throw new BadRequestException('En fazla iki seviye: alt kategoriye alt kategori eklenemez');
    }

    const baseSlug = slugify(dto.name) || 'kategori';
    const exists = await this.prisma.category.findFirst({ where: { storeId, slug: baseSlug } });
    const slug = exists ? `${baseSlug}-${randomSuffix()}` : baseSlug;
    return this.prisma.category.create({
      data: { storeId, name: dto.name, slug, parentId: dto.parentId, sortOrder: dto.sortOrder ?? 0 },
    });
  }

  // ---- Urunler ----
  listProducts(storeId: string, categoryId?: string, skip = 0, take = 50) {
    return this.prisma.product.findMany({
      // Ust baslik secilirse alt basliklarin urunleri de gelir (iki seviyeli agac).
      where: {
        storeId, isActive: true, deletedAt: null,
        // Askiya alinan saticinin YAYINDAKI urunleri de gizlenir. Suzme okuma
        // aninda: urun kayitlarina dokunulmuyor, askidan cikinca vitrin
        // kendiliginden geri geliyor.
        store: { seller: { status: SellerStatus.ACTIVE } },
        ...(categoryId ? { OR: [{ categoryId }, { category: { parentId: categoryId } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Math.min(take, 100),
    });
  }

  // Onay bekleyen (yayinda olmayan) urunler - magaza sahibi veya admin gorur
  async listPending(storeId: string, userId: string, roles: Role[]) {
    await this.market.assertOwner(storeId, userId, roles);
    return this.prisma.product.findMany({
      where: { storeId, isActive: false, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Ic kullanim: onay/red/guncelleme/silme akislari bu metodu kullanir.
  // Onay bekleyen (isActive:false) urunu de dondurur - approve/reject onsuz calismaz.
  async getProduct(id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!product) throw new NotFoundException('Urun bulunamadi');
    return product;
  }

  // Public okuma: yalnizca yayindaki urun. Onay bekleyen urunun fiyat/komisyon/KDV
  // kirilimi disariya sizmasin diye ayri metot; getProduct'a filtre eklenemez
  // cunku approve/reject onun uzerinden yurur.
  async getPublicProduct(id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, isActive: true, deletedAt: null, store: { seller: { status: SellerStatus.ACTIVE } } },
    });
    if (!product) throw new NotFoundException('Urun bulunamadi');
    return product;
  }

  // Kategori adini cekip urun adi ile birlikte KDV oranini otomatik tanir.
  // Satici DTO'da acik kdvOrani gonderdiyse o oran onceliklidir (otomatik atlanir).
  private async kdvOraniBelirle(
    dtoKdvOrani: number | undefined,
    urunAdi: string,
    categoryId?: string,
  ): Promise<number> {
    if (dtoKdvOrani !== undefined) return dtoKdvOrani; // satici acik girdi -> oncelikli
    let kategoriAdi: string | undefined;
    if (categoryId) {
      const kat = await this.prisma.category.findUnique({
        where: { id: categoryId },
        select: { name: true },
      });
      kategoriAdi = kat?.name;
    }
    return kdvOraniBul(urunAdi, kategoriAdi).oran; // otomatik tani; eslesme yoksa %20
  }

  async createProduct(storeId: string, userId: string, roles: Role[], dto: CreateProductDto) {
    await this.market.assertOwner(storeId, userId, roles);
    const baseSlug = slugify(dto.name) || 'urun';
    const exists = await this.prisma.product.findFirst({ where: { storeId, slug: baseSlug } });
    const slug = exists ? `${baseSlug}-${randomSuffix()}` : baseSlug;

    const desi = dto.desi ?? 0;
    const weightKg = dto.weightKg ?? 0;
    const satisModeli = dto.satisModeli ?? 'A';
    // net fiyat: dto.netFiyat varsa onu, yoksa dto.price'i net say
    const netKurus = BigInt(dto.netFiyat ?? dto.price ?? 0);

    // KDV orani: acik verildiyse o, yoksa kategori+isimden otomatik
    const kdvOrani = await this.kdvOraniBelirle(dto.kdvOrani, dto.name, dto.categoryId);

    // Komisyon orani magazadan (merkezi): commissionRate binde (800=%8) -> yuzde (/100 -> 8n)
    const magaza1 = await this.prisma.store.findUnique({ where: { id: storeId }, select: { commissionRate: true } });
    const komisyonOran1 = BigInt(magaza1?.commissionRate ?? 800) / 100n;

    // Vitrin fiyati + ayristirilmis muhasebe kalemleri
    const hesap = vitrinFiyatHesapla(netKurus, desi, weightKg, satisModeli, kdvOrani, komisyonOran1);
    if (!hesap.ok) throw new BadRequestException(hesap.sebep);

    return this.prisma.product.create({
      data: {
        storeId,
        categoryId: dto.categoryId,
        name: dto.name,
        slug,
        description: dto.description,
        sku: dto.sku,
        imageUrl: dto.imageUrl,
        price: hesap.vitrinKurus, // musterinin gordugu fiyat (gomulu)
        netFiyat: netKurus,
        kdvOrani,
        // --- Muhasebe kirilimi (price = netFiyat + asagidaki 4 kalem) ---
        komisyonTutari: hesap.komisyonKurus,
        kargoTutari: hesap.kargoKurus + hesap.yuvarlamaKurus, // yuvarlama farki kargoya
        malKdvTutari: hesap.malKdvKurus, // saticinin KDV beyani
        hizmetKdvTutari: hesap.hizmetKdvKurus, // platformun KDV beyani
        satisModeli,
        stock: dto.stock ?? 0,
        unit: dto.unit ?? 'adet',
        desi,
        weightKg,
        isActive: false, // satici ekledi -> admin onayi bekliyor (KDV orani burada teyit edilir)
      },
    });
  }

  async updateProduct(id: string, userId: string, roles: Role[], dto: UpdateProductDto) {
    const product = await this.getProduct(id);
    await this.market.assertOwner(product.storeId, userId, roles);

    // Guncel degerler (dto'da yoksa mevcut urundekini kullan)
    const desi = dto.desi ?? product.desi;
    const weightKg = dto.weightKg ?? product.weightKg;
    const satisModeli = dto.satisModeli ?? product.satisModeli;
    const netKurus = dto.netFiyat !== undefined ? BigInt(dto.netFiyat) : product.netFiyat;
    // KDV: dto'da acik geldiyse o, yoksa urunun mevcut orani korunur
    // (otomatik tanima sadece create'te; update'te admin/saticinin kararina dokunmuyoruz)
    const kdvOrani = dto.kdvOrani ?? product.kdvOrani;

    // Komisyon orani magazadan (merkezi)
    const magaza2 = await this.prisma.store.findUnique({ where: { id: product.storeId }, select: { commissionRate: true } });
    const komisyonOran2 = BigInt(magaza2?.commissionRate ?? 800) / 100n;

    const hesap = vitrinFiyatHesapla(netKurus, desi, weightKg, satisModeli, kdvOrani, komisyonOran2);
    if (!hesap.ok) throw new BadRequestException(hesap.sebep);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { ...dto };
    data.price = hesap.vitrinKurus;
    data.netFiyat = netKurus;
    data.kdvOrani = kdvOrani;
    data.komisyonTutari = hesap.komisyonKurus;
    data.kargoTutari = hesap.kargoKurus + hesap.yuvarlamaKurus;
    data.malKdvTutari = hesap.malKdvKurus;
    data.hizmetKdvTutari = hesap.hizmetKdvKurus;
    data.desi = desi;
    data.weightKg = weightKg;
    data.satisModeli = satisModeli;

    return this.prisma.product.update({ where: { id }, data });
  }

  // Urun onayi PLATFORM YONETICISININ isidir (ADMIN / SUPER_ADMIN).
  //
  // Onceki hali celisikti: once magaza sahibi reddediliyor ("kendi urununu
  // onaylayamazsin"), hemen ardindan assertOwner cagriliyordu - o da yalnizca
  // magaza sahibini ya da SUPER_ADMIN'i geciriyordu. Iki kontrol birbirini
  // kesiyor, geriye tek gecen olarak SUPER_ADMIN kaliyordu; PRODUCT_APPROVE
  // izni ise hicbir ucta kullanilmadigi icin oludu.
  private assertPlatformYoneticisi(roles: Role[]) {
    if (!roles.includes(Role.ADMIN) && !roles.includes(Role.SUPER_ADMIN)) {
      throw new ForbiddenException('Urun onayi icin platform yoneticisi yetkisi gerekli');
    }
  }

  /**
   * "Kendi urununu onaylama" yasagi SAHIPLIKLE SINIRLI DEGIL: magazanin personeli
   * de kendi katalogunu yayina alamaz. Aksi halde StoreUser eklendigi anda kapi
   * yeniden acilirdi - sahip onaylayamaz ama onun ekledigi personel onaylardi.
   */
  private async magazayaBagliMi(storeId: string, userId: string): Promise<boolean> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { ownerId: true } });
    if (store?.ownerId === userId) return true;
    return this.market.uyeMi(storeId, userId);
  }

  /**
   * BR-001 — aktif olmayan satici urununu yayina alamaz.
   * Yayina alma yolu TEK: approveProduct. Kontrol burada.
   */
  private async assertSaticiAktif(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { seller: { select: { status: true, displayName: true } } },
    });
    if (store?.seller?.status !== SellerStatus.ACTIVE) {
      throw new ForbiddenException(
        `Satıcı aktif değil (${store?.seller?.status ?? 'bulunamadı'}); ürün yayına alınamaz`,
      );
    }
  }

  // Admin: onayla -> yayinla
  async approveProduct(id: string, userId: string, roles: Role[]) {
    const product = await this.getProduct(id);
    await this.assertSaticiAktif(product.storeId);
    if (await this.magazayaBagliMi(product.storeId, userId)) {
      throw new ForbiddenException('Kendi magazanizin urununu onaylayamazsiniz');
    }
    this.assertPlatformYoneticisi(roles);
    return this.prisma.product.update({ where: { id }, data: { isActive: true } });
  }

  // Admin: reddet -> sil (soft delete)
  async rejectProduct(id: string, userId: string, roles: Role[]) {
    const product = await this.getProduct(id);
    if (await this.magazayaBagliMi(product.storeId, userId)) {
      throw new ForbiddenException('Kendi magazanizin urununu reddedemezsiniz');
    }
    this.assertPlatformYoneticisi(roles);
    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { rejected: true };
  }

  async removeProduct(id: string, userId: string, roles: Role[]) {
    const product = await this.getProduct(id);
    await this.market.assertOwner(product.storeId, userId, roles);
    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { deleted: true };
  }
}
