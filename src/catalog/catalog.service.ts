import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MarketService } from '../market/market.service';
import { slugify, randomSuffix } from '../common/util/slug';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

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

  async createProduct(storeId: string, userId: string, roles: Role[], dto: CreateProductDto) {
    await this.market.assertOwner(storeId, userId, roles);
    const baseSlug = slugify(dto.name) || 'urun';
    const exists = await this.prisma.product.findFirst({ where: { storeId, slug: baseSlug } });
    const slug = exists ? `${baseSlug}-${randomSuffix()}` : baseSlug;
    return this.prisma.product.create({
      data: {
        storeId,
        categoryId: dto.categoryId,
        name: dto.name,
        slug,
        description: dto.description,
        sku: dto.sku,
        imageUrl: dto.imageUrl,
        price: BigInt(dto.price),
        stock: dto.stock ?? 0,
        unit: dto.unit ?? 'adet',
        desi: dto.desi ?? 0,
        weightKg: dto.weightKg ?? 0,
        isActive: false, // satici ekledi -> onay bekliyor; admin onaylayinca yayinlanir
      },
    });
  }

  async updateProduct(id: string, userId: string, roles: Role[], dto: UpdateProductDto) {
    const product = await this.getProduct(id);
    await this.market.assertOwner(product.storeId, userId, roles);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { ...dto };
    if (dto.price !== undefined) data.price = BigInt(dto.price);
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
