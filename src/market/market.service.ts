import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { slugify, randomSuffix } from '../common/util/slug';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';

@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listActive(skip = 0, take = 50) {
    return this.prisma.store.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Math.min(take, 100),
    });
  }

  async getById(id: string) {
    const store = await this.prisma.store.findFirst({ where: { id, deletedAt: null } });
    if (!store) throw new NotFoundException('Mağaza bulunamadı');
    return store;
  }

  async getBySlug(slug: string) {
    const store = await this.prisma.store.findFirst({ where: { slug, deletedAt: null } });
    if (!store) throw new NotFoundException('Mağaza bulunamadı');
    return store;
  }

  myStores(ownerId: string) {
    return this.prisma.store.findMany({
      where: { ownerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(ownerId: string, dto: CreateStoreDto, ip?: string) {
    const baseSlug = slugify(dto.name) || 'magaza';
    const exists = await this.prisma.store.findUnique({ where: { slug: baseSlug } });
    const slug = exists ? `${baseSlug}-${randomSuffix()}` : baseSlug;

    const store = await this.prisma.store.create({
      data: {
        ownerId,
        name: dto.name,
        slug,
        type: dto.type,
        description: dto.description,
        logoUrl: dto.logoUrl,
        phone: dto.phone,
        city: dto.city,
        district: dto.district,
        line1: dto.line1,
        minOrder: dto.minOrder ? BigInt(dto.minOrder) : 0n,
      },
    });
    await this.audit.record({ actorId: ownerId, action: 'store.create', entity: 'Store', entityId: store.id, ip });
    return store;
  }

  private async ownedOrAdmin(storeId: string, userId: string, roles: Role[]) {
    const store = await this.getById(storeId);
    const isAdmin = roles.includes(Role.SUPER_ADMIN);
    if (store.ownerId !== userId && !isAdmin) {
      throw new ForbiddenException('Bu mağaza size ait değil');
    }
    return store;
  }

  async update(storeId: string, userId: string, roles: Role[], dto: UpdateStoreDto, ip?: string) {
    await this.ownedOrAdmin(storeId, userId, roles);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { ...dto };
    if (dto.minOrder !== undefined) data.minOrder = BigInt(dto.minOrder);
    const store = await this.prisma.store.update({ where: { id: storeId }, data });
    await this.audit.record({ actorId: userId, action: 'store.update', entity: 'Store', entityId: storeId, ip });
    return store;
  }

  async assertOwner(storeId: string, userId: string, roles: Role[]) {
    return this.ownedOrAdmin(storeId, userId, roles);
  }
}
