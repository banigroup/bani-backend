import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Role, SellerStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { SellerStatusService } from './seller-status.service';
import { sifrele, son4 } from '../common/crypto/gizli-alan';
import { slugify, randomSuffix } from '../common/util/slug';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';

@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly saticiDurum: SellerStatusService,
  ) {}

  // SATICI DURUMU VITRINI ETKILER: satici ACTIVE degilse magazalari musteriye
  // gorunmez. Askiya alma "yeni urun yayinlayamaz" ile sinirli degil, mevcut
  // vitrin de kapanir (okuma aninda suzuluyor; urun/magaza kayitlarina
  // DOKUNULMUYOR ki askidan cikinca eski hal kendiliginden geri gelsin).
  listActive(skip = 0, take = 50) {
    return this.prisma.store.findMany({
      where: { isActive: true, deletedAt: null, seller: { status: SellerStatus.ACTIVE } },
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

  /**
   * Magaza yaratirken satici kaydi ZORUNLU (stores.sellerId NOT NULL).
   * Kullanicinin saticisi yoksa DRAFT bir kayit acilir - boylece mevcut
   * "magaza olustur" akisi kirilmaz. DRAFT satici ACTIVE olmadigi icin magaza
   * vitrinde gorunmez ve urun yayina alinamaz (BR-001); satici once profilini
   * doldurup onaya gonderir.
   */
  private async saticiSaglaVeGetir(ownerId: string) {
    const mevcut = await this.prisma.seller.findFirst({ where: { ownerUserId: ownerId, deletedAt: null } });
    if (mevcut) return mevcut;
    const u = await this.prisma.user.findUnique({ where: { id: ownerId }, select: { name: true, surname: true } });
    const ad = [u?.name, u?.surname].filter(Boolean).join(' ').trim() || `Satici ${ownerId.slice(0, 8)}`;
    return this.prisma.seller.create({
      data: { ownerUserId: ownerId, sellerType: 'MARKET', legalName: ad, displayName: ad },
    });
  }

  async create(ownerId: string, dto: CreateStoreDto, ip?: string) {
    const satici = await this.saticiSaglaVeGetir(ownerId);
    const baseSlug = slugify(dto.name) || 'magaza';
    const exists = await this.prisma.store.findUnique({ where: { slug: baseSlug } });
    const slug = exists ? `${baseSlug}-${randomSuffix()}` : baseSlug;

    const store = await this.prisma.store.create({
      data: {
        ownerId,
        sellerId: satici.id,
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

  // ---------------- SATICI (SELLER) ----------------

  /** Kullanicinin satici kaydi. taxIdentifier COZULMEZ - yalnizca son 4 hane doner. */
  async saticim(userId: string) {
    const s = await this.prisma.seller.findFirst({
      where: { ownerUserId: userId, deletedAt: null },
      select: {
        id: true, sellerType: true, legalName: true, displayName: true, taxLast4: true,
        status: true, verification: true, verificationExpiresAt: true, createdAt: true,
        stores: { select: { id: true, name: true, slug: true, businessUnit: true, parentId: true } },
      },
    });
    if (!s) throw new NotFoundException('Satıcı kaydı bulunamadı');
    return s;
  }

  private async saticimHam(userId: string) {
    const s = await this.prisma.seller.findFirst({ where: { ownerUserId: userId, deletedAt: null } });
    if (!s) throw new NotFoundException('Satıcı kaydı bulunamadı');
    return s;
  }

  /**
   * Satici profili guncelleme. Vergi kimligi VERILIRSE sifrelenerek yazilir ve
   * son 4 hane ayrica saklanir (listelerde blogu cozmeye gerek kalmasin).
   * ACTIVE bir saticinin vergi kimligini degistirmek dogrulamayi dusurur:
   * onaylanmis kimlik degistiyse eski onay artik o kimligin onayi degildir.
   */
  async saticiGuncelle(
    userId: string,
    dto: { sellerType?: any; legalName?: string; displayName?: string; taxIdentifier?: string },
  ) {
    const mevcut = await this.saticimHam(userId);
    const data: any = {};
    if (dto.sellerType !== undefined) data.sellerType = dto.sellerType;
    if (dto.legalName !== undefined) data.legalName = dto.legalName;
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.taxIdentifier !== undefined) {
      data.taxIdentifier = sifrele(dto.taxIdentifier);
      data.taxLast4 = son4(dto.taxIdentifier);
      data.verification = 'BEKLIYOR';
      data.verificationExpiresAt = null;
    }
    await this.prisma.seller.update({ where: { id: mevcut.id }, data });
    return this.saticim(userId);
  }

  /** DRAFT | NEEDS_FIX -> UNDER_REVIEW. Zorunlu alanlar dolu degilse reddedilir. */
  async saticiOnayaGonder(userId: string) {
    const s = await this.saticimHam(userId);
    if (!s.taxIdentifier) throw new ConflictException('Vergi kimliği olmadan onaya gönderilemez');
    if (!s.legalName?.trim()) throw new ConflictException('Ticari unvan zorunlu');
    await this.prisma.$transaction((tx) =>
      this.saticiDurum.gecis(tx, s.id, [SellerStatus.DRAFT, SellerStatus.NEEDS_FIX], {
        status: SellerStatus.UNDER_REVIEW,
      }),
    );
    return this.saticim(userId);
  }

  /** Platform yoneticisi durum gecisi. Harita disi gecis 409 doner. */
  async saticiDurumDegistir(roles: Role[], sellerId: string, hedef: SellerStatus) {
    if (!this.platformYoneticisi(roles)) {
      throw new ForbiddenException('Satıcı durumu için admin yetkisi gerekli');
    }
    const s = await this.prisma.seller.findUnique({ where: { id: sellerId } });
    if (!s) throw new NotFoundException('Satıcı bulunamadı');
    if (!this.saticiDurum.gecerliMi(s.status, hedef)) {
      throw new ConflictException(`Geçersiz satıcı durum geçişi: ${s.status} -> ${hedef}`);
    }
    // ACTIVE'e gecis dogrulama onayi ister; askiya alma/kapatma istemez.
    if (hedef === SellerStatus.ACTIVE && s.verification !== 'ONAYLANDI') {
      throw new ConflictException('Doğrulaması onaylanmamış satıcı aktifleştirilemez');
    }
    await this.prisma.$transaction((tx) => this.saticiDurum.gecis(tx, sellerId, [s.status], { status: hedef }));
    return this.prisma.seller.findUnique({
      where: { id: sellerId },
      select: { id: true, status: true, verification: true, displayName: true },
    });
  }

  /** Dogrulama sonucu (admin): onay + bitis tarihi ya da red. */
  async saticiDogrulama(roles: Role[], sellerId: string, sonuc: 'ONAYLANDI' | 'REDDEDILDI', bitis?: Date) {
    if (!this.platformYoneticisi(roles)) {
      throw new ForbiddenException('Doğrulama için admin yetkisi gerekli');
    }
    return this.prisma.seller.update({
      where: { id: sellerId },
      data: { verification: sonuc, verificationExpiresAt: sonuc === 'ONAYLANDI' ? (bitis ?? null) : null },
      select: { id: true, verification: true, verificationExpiresAt: true },
    });
  }

  /**
   * BR-014 — magaza su an acik mi.
   *
   * KAYIT YOKSA ACIK SAYILIR: aksi halde store_hours tablosu eklendigi an canli
   * 5 magazanin hepsi kapanirdi (hicbirinde saat kaydi yok).
   * Ayni gun icin birden fazla gecerli kayit varsa EN YENI effectiveFrom kazanir
   * (sezonluk saat eskisinin uzerine yazmadan tanimlanabilsin).
   */
  async acikMi(storeId: string, an: Date = new Date()): Promise<boolean> {
    const gun = an.getDay();
    const bugun = new Date(Date.UTC(an.getFullYear(), an.getMonth(), an.getDate()));
    const kayit = await this.prisma.storeHour.findFirst({
      where: {
        storeId,
        weekday: gun,
        effectiveFrom: { lte: bugun },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: bugun } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!kayit) return true;
    if (kayit.isClosed) return false;
    const dk = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
    const simdi = an.getHours() * 60 + an.getMinutes();
    const acilis = dk(kayit.openTime);
    const kapanis = dk(kayit.closeTime);
    // Gece yarisini asan mesai (or. 20:00 - 02:00) tek araliga sigmaz.
    return acilis <= kapanis ? simdi >= acilis && simdi < kapanis : simdi >= acilis || simdi < kapanis;
  }

  async assertOwner(storeId: string, userId: string, roles: Role[]) {
    return this.ownedOrAdmin(storeId, userId, roles);
  }
}
