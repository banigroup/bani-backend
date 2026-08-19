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

  // Sahip olunan VE personel olarak calisilan magazalar. Paneller buradan
  // basliyor; uyelik eklendiginde magaza listede gorunmezse uye hicbir yere
  // ulasamaz (storeId'yi bilmesinin baska yolu yok).
  myStores(ownerId: string) {
    return this.prisma.store.findMany({
      where: {
        deletedAt: null,
        OR: [
          { ownerId },
          { personel: { some: { userId: ownerId, isActive: true } } },
        ],
      },
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

  // PLATFORM YONETICISI: ADMIN ve SUPER_ADMIN (orders.service.isAdmin ile ayni
  // tanim). Eskiden yalnizca SUPER_ADMIN vardi cunku o satir Faz 2'de yazildi,
  // ADMIN rolu Faz 5'te eklendi ve bu dosya guncellenmedi.
  private platformYoneticisi(roles: Role[]): boolean {
    return roles.includes(Role.ADMIN) || roles.includes(Role.SUPER_ADMIN);
  }

  /** Kullanici bu magazada AKTIF personel mi. */
  async uyeMi(storeId: string, userId: string): Promise<boolean> {
    const uyelik = await this.prisma.storeUser.findUnique({
      where: { storeId_userId: { storeId, userId } },
      select: { isActive: true },
    });
    return uyelik?.isActive === true;
  }

  /**
   * MAGAZA ERISIMININ TEK KAYNAGI: sahip | aktif personel | platform yoneticisi.
   *
   * Magaza NESNESINI alir, id'yi degil - cagiran taraf magazayi zaten okumussa
   * (orders.service'te oyle) ikinci bir sorgu acilmasin diye. isAdmin'in iki ayri
   * yerde farkli tanimlanmasi gibi bir ayrisma olmasin diye kural burada TEK.
   */
  async erisebilir(store: { id: string; ownerId: string }, userId: string, roles: Role[]): Promise<boolean> {
    if (store.ownerId === userId) return true;
    if (this.platformYoneticisi(roles)) return true;
    return this.uyeMi(store.id, userId);
  }

  private async ownedOrAdmin(storeId: string, userId: string, roles: Role[]) {
    const store = await this.getById(storeId);
    if (!(await this.erisebilir(store, userId, roles))) {
      throw new ForbiddenException('Bu mağaza size ait değil');
    }
    return store;
  }

  /**
   * UYELIK YONETIMI erisimden DAHA DAR: yalnizca magaza sahibi ve platform
   * yoneticisi. Personelin personel eklemesi kapali - aksi halde bir uye
   * kendini cogaltip magazayi ele gecirebilirdi.
   */
  private async sahipVeyaYonetici(storeId: string, userId: string, roles: Role[]) {
    const store = await this.getById(storeId);
    if (store.ownerId !== userId && !this.platformYoneticisi(roles)) {
      throw new ForbiddenException('Personel yönetimi için mağaza sahibi ya da admin yetkisi gerekli');
    }
    return store;
  }

  // ---------------- MAGAZA PERSONELI ----------------

  async personelListesi(storeId: string, userId: string, roles: Role[]) {
    await this.sahipVeyaYonetici(storeId, userId, roles);
    return this.prisma.storeUser.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, userId: true, isActive: true, createdAt: true,
        user: { select: { phone: true, name: true, surname: true, roles: true } },
      },
    });
  }

  async personelEkle(storeId: string, userId: string, roles: Role[], eklenecekUserId: string) {
    const store = await this.sahipVeyaYonetici(storeId, userId, roles);
    const kisi = await this.prisma.user.findFirst({ where: { id: eklenecekUserId, deletedAt: null } });
    if (!kisi) throw new NotFoundException('Kullanıcı bulunamadı');
    if (kisi.id === store.ownerId) {
      throw new ForbiddenException('Mağaza sahibi zaten tam yetkili; personel olarak eklenmez');
    }
    // upsert: daha once kapatilmis bir uyelik varsa yeniden ACILIR, ikinci satir
    // yaratilmaz (bilesik unique zaten engellerdi, burada net hata yerine niyet).
    return this.prisma.storeUser.upsert({
      where: { storeId_userId: { storeId, userId: eklenecekUserId } },
      create: { storeId, userId: eklenecekUserId },
      update: { isActive: true },
      select: { id: true, userId: true, isActive: true, createdAt: true },
    });
  }

  async personelDurum(storeId: string, userId: string, roles: Role[], hedefUserId: string, isActive: boolean) {
    await this.sahipVeyaYonetici(storeId, userId, roles);
    const uyelik = await this.prisma.storeUser.findUnique({
      where: { storeId_userId: { storeId, userId: hedefUserId } },
    });
    if (!uyelik) throw new NotFoundException('Personel kaydı bulunamadı');
    return this.prisma.storeUser.update({
      where: { id: uyelik.id },
      data: { isActive },
      select: { id: true, userId: true, isActive: true },
    });
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
