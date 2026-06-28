import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
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
  listCategories(storeId: string) {
    return this.prisma.category.findMany({
      where: { storeId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createCategory(storeId: string, userId: string, roles: Role[], dto: CreateCategoryDto) {
    await this.market.assertOwner(storeId, userId, roles);
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
      where: { storeId, isActive: true, deletedAt: null, ...(categoryId ? { categoryId } : {}) },
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

  async getProduct(id: string) {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
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

    // Vitrin fiyati + ayristirilmis muhasebe kalemleri
    const hesap = vitrinFiyatHesapla(netKurus, desi, weightKg, satisModeli, kdvOrani);
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

    const hesap = vitrinFiyatHesapla(netKurus, desi, weightKg, satisModeli, kdvOrani);
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

  // Admin: onayla -> yayinla
  async approveProduct(id: string, userId: string, roles: Role[]) {
    const product = await this.getProduct(id);
    await this.market.assertOwner(product.storeId, userId, roles);
    return this.prisma.product.update({ where: { id }, data: { isActive: true } });
  }

  // Admin: reddet -> sil (soft delete)
  async rejectProduct(id: string, userId: string, roles: Role[]) {
    const product = await this.getProduct(id);
    await this.market.assertOwner(product.storeId, userId, roles);
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
