import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { Role, SellerStatus, SellerVerification, SaticiBelgeTipi, SaticiBelgeDurum, SozlesmeTipi } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { SellerStatusService } from './seller-status.service';
import { sifrele, son4 } from '../common/crypto/gizli-alan';
import { slugify, randomSuffix } from '../common/util/slug';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { platformYoneticisi as platformYoneticisiKurali } from '../common/rbac/rol-kontrol';

/**
 * FAZ 1 / B2 — B2 UCLARINDAN ATANABILEN ROLLER. Kodda sabit, veride degil:
 * korundugumuz sey magaza yoneticisinin yanlis/kotu niyetli girdisi. Guard'daki
 * MAGAZA_ROLU_IZIN_BEYAZ_LISTESI ile ayni gerekce, ayni desen.
 *
 * STORE_STAFF LISTEDE YOK: uyelik kaydinin turevi, yalnizca personelEkle /
 * personelDurum yonetir.
 */
export const ATANABILIR_MAGAZA_ROLLERI: ReadonlySet<Role> = new Set([
  Role.STORE_KITCHEN,
  Role.STORE_CASHIER,
  Role.STORE_STOCK,
]);

@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly saticiDurum: SellerStatusService,
    private readonly sozlesme: SozlesmeService,
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

  // Tanim TEK KAYNAKTA: common/rbac/rol-kontrol. Eskiden burada yerel kopya
  // vardi; ADMIN rolu Faz 5'te eklendiginde kopyalarin ayrismasi ADMIN'i
  // kilitlemisti - o sinifin tekrarlanmamasi icin kural tek dosyada.
  private platformYoneticisi(roles: Role[]): boolean {
    return platformYoneticisiKurali(roles);
  }

  /**
   * Kullanicinin BU MAGAZADA yetkisi var mi.
   *
   * FAZ 1 / C4 — KAYNAK DEGISTI: eskiden store_users.isActive okunuyordu, artik
   * user_roles'ta o magazaya kapsanmis rol satiri araniyor. Sebep: ayni soruyu
   * ("bu kisi bu magazada calisiyor mu") iki tablo birden cevapliyordu; yetki
   * kararinin tek kaynagi olmaliydi. store_users UYELIK KAYDI olarak duruyor
   * (davet/pasiflestirme yasam dongusu), ama YETKI icin ARTIK OKUNMUYOR.
   *
   * Ikisinin ayrismamasi personelEkle/personelDurum'da tek transaction ile
   * garanti ediliyor: uyelik yazilinca rol satiri da yazilir, uyelik
   * pasiflestirilince o magazanin rol satirlari ayni islemde silinir. Yani
   * "uye pasif ama rol satiri duruyor" hali hic olusmaz.
   *
   * Ad KORUNDU: erisebilir'in okunusunu bozmamak icin. Anlami "uyelik satiri
   * var mi" degil, "bu magazada rolu var mi".
   */
  async uyeMi(storeId: string, userId: string): Promise<boolean> {
    const rol = await this.prisma.userRole.findFirst({
      where: { userId, storeId },
      select: { id: true },
    });
    return rol !== null;
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
   *
   * C4'TE BILEREK DEGISTIRILMEDI: STORE_STAFF buradan GECMEZ. erisebilir'in
   * kaynagi user_roles'a tasindi ama bu kapi hala yalnizca sahiplik + platform
   * yoneticiligi soruyor. Eksiklik degil, karar: magaza kapsamli rolun kendi
   * kadrosunu genisletebilmesi yetki yukseltme yolu acardi.
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
        // Rol artik ayri tabloda (Faz 1 / A1). Personel ekraninin gordugu sey
        // degismesin diye ayni yerden, ayni ad altinda donuluyor.
        //
        // C4 — BU MAGAZAYLA SINIRLI: filtre olmasaydi A magazasinin sahibi,
        // personelinin B magazasindaki rolunu ve platform rollerini gorurdu.
        // Kapsam geldigi anda dogan sizinti; filtre kapsamla ayni pakette.
        user: {
          select: {
            phone: true, name: true, surname: true,
            rolAtamalari: { where: { storeId }, select: { role: true } },
          },
        },
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
    // C4 — UYELIK VE ROL AYNI TRANSACTION'DA. Ikisi ayri islemde yazilsaydi
    // arada kalan istek "uye ama rolsuz" bir kisi gorurdu; erisim kaynagi artik
    // rol satiri oldugu icin bu, uyeligi yazilmis personelin erisememesi
    // demekti. Iki upsert de IDEMPOTENT: ikinci cagri mukerrer satir uretmez.
    const [uyelik] = await this.prisma.$transaction([
      this.prisma.storeUser.upsert({
        where: { storeId_userId: { storeId, userId: eklenecekUserId } },
        create: { storeId, userId: eklenecekUserId },
        update: { isActive: true }, // kapatilmis uyelik yeniden ACILIR
        select: { id: true, userId: true, isActive: true, createdAt: true },
      }),
      this.prisma.userRole.upsert({
        where: { userId_role_storeId: { userId: eklenecekUserId, role: Role.STORE_STAFF, storeId } },
        create: { userId: eklenecekUserId, role: Role.STORE_STAFF, storeId },
        update: {}, // varsa dokunma
        select: { id: true },
      }),
    ]);
    return uyelik;
  }

  async personelDurum(storeId: string, userId: string, roles: Role[], hedefUserId: string, isActive: boolean) {
    await this.sahipVeyaYonetici(storeId, userId, roles);
    const uyelik = await this.prisma.storeUser.findUnique({
      where: { storeId_userId: { storeId, userId: hedefUserId } },
    });
    if (!uyelik) throw new NotFoundException('Personel kaydı bulunamadı');

    // C4 — DURUM VE ROL AYNI TRANSACTION'DA:
    //   pasiflestirme -> o magazaya ait ROL SATIRLARI SILINIR (yalnizca
    //     STORE_STAFF degil, hepsi: B adiminda gelecek mutfak/kasa rolleri de
    //     ayni kadroya bagli olacak, uyelik kapaninca hicbiri kalmamali).
    //   yeniden acma  -> STORE_STAFF satiri geri yazilir.
    // Ayri islemler olsaydi "uyelik pasif ama rol satiri duruyor" hali dogar,
    // guard'in iki yere birden bakmasi gerekirdi - C'nin kapattigi ikilik
    // baska bicimde geri gelirdi.
    //
    // ASIMETRI COZULDU (Faz 1 / B2) — KASITLI, BUG DEGIL: hesap yeniden
    // acilinca yetki-yogun roller (STORE_KITCHEN / STORE_CASHIER / STORE_STOCK)
    // OTOMATIK geri gelmez; sahip/yonetici B2 uclariyla acikca yeniden atar
    // (POST .../users/:userId/roles). Savunma derinligi: yeniden aktiflestirme
    // onceki yetkileri sessizce restore etmemeli - isten ayrilip donen ya da
    // hatayla kapatilip acilan bir hesap, kapatildigi andaki yetkileriyle
    // canlanmamali.
    //
    // Bu yuzden asagidaki dal DEGISTIRILMEDI: pasiflestirme o magazanin TUM
    // rol satirlarini siler, yeniden acma yalnizca STORE_STAFF yazar.
    const [guncel] = await this.prisma.$transaction([
      this.prisma.storeUser.update({
        where: { id: uyelik.id },
        data: { isActive },
        select: { id: true, userId: true, isActive: true },
      }),
      isActive
        ? this.prisma.userRole.upsert({
            where: { userId_role_storeId: { userId: hedefUserId, role: Role.STORE_STAFF, storeId } },
            create: { userId: hedefUserId, role: Role.STORE_STAFF, storeId },
            update: {},
            select: { id: true },
          })
        : this.prisma.userRole.deleteMany({ where: { userId: hedefUserId, storeId } }),
    ]);
    return guncel;
  }

  // ---------------- MAGAZA ROL ATAMA (Faz 1 / B2) ----------------

  /** Kisinin BU magazadaki rolleri (STORE_STAFF dahil), okunabilir sirada. */
  private async magazaRolleri(storeId: string, hedefUserId: string): Promise<Role[]> {
    const satirlar = await this.prisma.userRole.findMany({
      where: { userId: hedefUserId, storeId },
      select: { role: true },
      orderBy: { role: 'asc' },
    });
    return [...new Set(satirlar.map((s) => s.role))];
  }

  /**
   * ATANABILIR ROL DOGRULAMASI — kodda sabit, veride degil.
   *
   * Bu kontrol olmasaydi bir magaza yoneticisi (kotu niyetle ya da yanlislikla)
   * ADMIN veya SUPER_ADMIN'i MAGAZA KAPSAMLI yazabilirdi. Boyle bir satir
   * guard'da bugun gorunmez (storeId dolu roller beyaz listeden geciyor) ama
   * user_roles'ta duran bir "ADMIN" satiri veri butunlugu acisindan zehirlidir:
   * ileride kapsamı gozetmeyen tek bir okuma yolu onu platform rolu sanabilir.
   *
   * STORE_STAFF de BILEREK disarida: uyelik kaydinin turevi, yalnizca
   * personelEkle/personelDurum yonetir. Iki kapidan yonetilen bir satir,
   * C'de kapatilan "ayni soruya iki cevap" ikiligini geri getirirdi.
   */
  private atanabilirRolDogrula(rol: string): Role {
    if (!(ATANABILIR_MAGAZA_ROLLERI as ReadonlySet<string>).has(rol)) {
      throw new BadRequestException(
        `Bu uctan yalnizca su roller atanabilir: ${[...ATANABILIR_MAGAZA_ROLLERI].join(', ')}`,
      );
    }
    return rol as Role;
  }

  /**
   * Rol atamak icin kisi o magazanin AKTIF kadrosunda olmali.
   *
   * Uyelik kaydi store_users'ta yasiyor (C4: yetki icin okunmuyor ama yasam
   * dongusu orada). Pasif uyeye rol yazilabilseydi, personelDurum'un
   * "pasiflestirince tum rolleri sil" garantisi delinirdi.
   */
  private async aktifUyelikDogrula(storeId: string, hedefUserId: string) {
    const uyelik = await this.prisma.storeUser.findUnique({
      where: { storeId_userId: { storeId, userId: hedefUserId } },
      select: { isActive: true },
    });
    if (!uyelik) throw new NotFoundException('Personel kaydı bulunamadı');
    if (!uyelik.isActive) {
      throw new BadRequestException('Pasif personele rol atanamaz; önce üyeliği yeniden açın');
    }
  }

  /** Idempotent: ayni rol ikinci kez verilirse mukerrer satir olusmaz. */
  async rolVer(storeId: string, userId: string, roles: Role[], hedefUserId: string, rol: string) {
    await this.sahipVeyaYonetici(storeId, userId, roles);
    const secilen = this.atanabilirRolDogrula(rol);
    await this.aktifUyelikDogrula(storeId, hedefUserId);

    const mevcut = await this.prisma.userRole.findUnique({
      where: { userId_role_storeId: { userId: hedefUserId, role: secilen, storeId } },
      select: { id: true },
    });
    if (!mevcut) {
      await this.prisma.userRole.create({ data: { userId: hedefUserId, role: secilen, storeId } });
    }
    return { degisti: !mevcut, roller: await this.magazaRolleri(storeId, hedefUserId) };
  }

  /**
   * Idempotent: atama yoksa hata DEGIL, degisti=false.
   * personelDurum'un pasiflestirme dali da ayni mantikta (deleteMany, yoksa
   * sessiz gecer) - iki yol tutarli olsun diye 404 tercih edilmedi.
   */
  async rolAl(storeId: string, userId: string, roles: Role[], hedefUserId: string, rol: string) {
    await this.sahipVeyaYonetici(storeId, userId, roles);
    const secilen = this.atanabilirRolDogrula(rol);
    // Uyelik AKTIFLIGI aranmaz: yetki GERI ALMAK her zaman guvenli yonde bir
    // islem, pasif uyenin artik satiri da kalmamis olabilir.
    const silinen = await this.prisma.userRole.deleteMany({
      where: { userId: hedefUserId, storeId, role: secilen },
    });
    return { degisti: silinen.count > 0, roller: await this.magazaRolleri(storeId, hedefUserId) };
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
   * B1 — ONAY BEKLEYEN SATICILAR (admin inceleme kuyrugu).
   *
   * Bugune kadar UNDER_REVIEW'daki saticilari listeleyen hicbir uc yoktu:
   * saticiDurumDegistir ve saticiDogrulama sellerId ISTIYOR ama admin o id'yi
   * hicbir yerden ogrenemiyordu. Bu uc o boslugu kapatir.
   *
   * Varsayilan UNDER_REVIEW - ekranin asil isi bu. status verilirse diger
   * durumlar da listelenir (NEEDS_FIX takibi, SUSPENDED denetimi).
   *
   * VERGI KIMLIGI DONMEZ: taxIdentifier sifreli bloktur ve listede isi yoktur;
   * saticim() ile ayni secim kullanilir, ekranda taxLast4 yeter.
   *
   * Siralama updatedAt ARTAN: en uzun bekleyen basta. Kuyruk mantigi budur;
   * createdAt olsaydi NEEDS_FIX'ten donen satici sirasini kaybederdi.
   */
  async saticiListele(roles: Role[], status?: string, skip = 0, take = 50) {
    if (!this.platformYoneticisi(roles)) {
      throw new ForbiddenException('Satıcı listesi için admin yetkisi gerekli');
    }
    if (status !== undefined && !(status in SellerStatus)) {
      throw new BadRequestException(`Geçersiz satıcı durumu: ${status}`);
    }
    const durum = (status as SellerStatus) ?? SellerStatus.UNDER_REVIEW;
    const where = { status: durum, deletedAt: null };

    const [toplam, kayitlar] = await this.prisma.$transaction([
      this.prisma.seller.count({ where }),
      this.prisma.seller.findMany({
        where,
        select: {
          id: true, sellerType: true, legalName: true, displayName: true, taxLast4: true,
          status: true, verification: true, verificationExpiresAt: true,
          createdAt: true, updatedAt: true,
          stores: { select: { id: true, name: true, slug: true, businessUnit: true } },
        },
        orderBy: { updatedAt: 'asc' },
        skip: Math.max(0, skip),
        take: Math.min(Math.max(1, take), 100),
      }),
    ]);
    return { durum, toplam, kayitlar };
  }

  // ---------------- SATICI KYC BELGELERI ----------------
  //
  // load_belgeleri (LoadBelge) deseninin satici karsiligi. Vergi kimliginin
  // "dogrulanmis" sayilmasi VERGI_LEVHASI belgesinin admin onayidir; canli bir
  // GIB cagrisi YOK, ayri bir "vergi dogrulandi" alani da yok. Sonuc tek yere,
  // Seller.verification'a yazilir.

  /**
   * Dogrulama icin ZORUNLU belge tipleri. Yeni zorunlu belge eklemek = bu
   * diziye bir satir; dogrulamaVerisiniTazele kendiliginden uyar.
   */
  private readonly ZORUNLU_BELGELER: SaticiBelgeTipi[] = [SaticiBelgeTipi.VERGI_LEVHASI];

  /**
   * Saticinin dogrulama durumunu BELGELERDEN YENIDEN HESAPLAR.
   *
   * Tek tek "onayda ONAYLANDI yap / redde REDDEDILDI yap" yazilmadi: o kurgu
   * ayni tipten ikinci bir belge reddedildiginde zaten onaylanmis saticinin
   * durumunu haksiz yere dusururdu. Durum, belge kumesinin SAF FONKSIYONUDUR.
   *
   * verificationExpiresAt'a DOKUNULMAZ: bitis tarihi admin karari,
   * saticiDogrulama ucundan yazilir (semadaki "Suresi Doldu sonuctur" notu).
   *
   * saticiDogrulama ile iliski: admin oradan elle durum yazabilir ve o deger
   * BIR SONRAKI belge islemine kadar gecerlidir. Belgeler tek kaynak oldugu
   * icin bilincli olarak boyle - iki kaynak birbiriyle celisirdi.
   */
  private async dogrulamaVerisiniTazele(sellerId: string) {
    const belgeler = await this.prisma.saticiBelge.findMany({
      where: { sellerId, deletedAt: null, tip: { in: this.ZORUNLU_BELGELER } },
      select: { tip: true, durum: true },
    });

    const tamam = this.ZORUNLU_BELGELER.every((t) =>
      belgeler.some((b) => b.tip === t && b.durum === SaticiBelgeDurum.ONAYLANDI),
    );
    const bekleyenVar = belgeler.some((b) => b.durum === SaticiBelgeDurum.BEKLIYOR);
    const redVar = belgeler.some((b) => b.durum === SaticiBelgeDurum.REDDEDILDI);

    const hedef: SellerVerification = tamam
      ? SellerVerification.ONAYLANDI
      : bekleyenVar
        ? SellerVerification.BEKLIYOR
        : redVar
          ? SellerVerification.REDDEDILDI
          : SellerVerification.EKSIK;

    return this.prisma.seller.update({
      where: { id: sellerId },
      data: { verification: hedef },
      select: { id: true, verification: true, verificationExpiresAt: true },
    });
  }

  /** Satici kendi belgesini yukler. Dosya zaten Cloudinary'e gitmis, burada URL saklanir. */
  async belgeEkle(userId: string, tip: string, dosyaUrl: string) {
    const s = await this.saticimHam(userId);
    if (!(tip in SaticiBelgeTipi)) throw new BadRequestException(`Geçersiz belge tipi: ${tip}`);
    const belge = await this.prisma.saticiBelge.create({
      data: { sellerId: s.id, tip: tip as SaticiBelgeTipi, dosyaUrl },
    });
    await this.dogrulamaVerisiniTazele(s.id);
    return belge;
  }

  /** Saticinin kendi belgeleri. */
  async belgelerim(userId: string) {
    const s = await this.saticimHam(userId);
    return this.prisma.saticiBelge.findMany({
      where: { sellerId: s.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Admin: onay bekleyen belgeler. B1'deki listeleme deseniyle ayni. */
  async bekleyenBelgeler(roles: Role[], skip = 0, take = 50) {
    if (!this.platformYoneticisi(roles)) {
      throw new ForbiddenException('Belge listesi için admin yetkisi gerekli');
    }
    const where = { durum: SaticiBelgeDurum.BEKLIYOR, deletedAt: null };
    const [toplam, kayitlar] = await this.prisma.$transaction([
      this.prisma.saticiBelge.count({ where }),
      this.prisma.saticiBelge.findMany({
        where,
        // Satici ozeti: vergi kimligi SIFRELI blob oldugu icin donmez, taxLast4 yeter.
        include: {
          seller: {
            select: {
              id: true, sellerType: true, legalName: true, displayName: true,
              taxLast4: true, status: true, verification: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' }, // en uzun bekleyen basta
        skip: Math.max(0, skip),
        take: Math.min(Math.max(1, take), 100),
      }),
    ]);
    return { toplam, kayitlar };
  }

  /** Admin: belge onayi. Sonrasinda saticinin dogrulama durumu yeniden hesaplanir. */
  async belgeOnayla(roles: Role[], belgeId: string) {
    return this.belgeKarar(roles, belgeId, SaticiBelgeDurum.ONAYLANDI);
  }

  /** Admin: belge reddi. Gerekce kayda gecer; dogrulama durumu yeniden hesaplanir. */
  async belgeReddet(roles: Role[], belgeId: string, gerekce?: string) {
    return this.belgeKarar(roles, belgeId, SaticiBelgeDurum.REDDEDILDI, gerekce);
  }

  private async belgeKarar(
    roles: Role[],
    belgeId: string,
    durum: SaticiBelgeDurum,
    gerekce?: string,
  ) {
    if (!this.platformYoneticisi(roles)) {
      throw new ForbiddenException('Belge kararı için admin yetkisi gerekli');
    }
    const belge = await this.prisma.saticiBelge.findFirst({
      where: { id: belgeId, deletedAt: null },
    });
    if (!belge) throw new NotFoundException('Belge bulunamadı');

    const guncel = await this.prisma.saticiBelge.update({
      where: { id: belgeId },
      data: {
        durum,
        // Red gerekcesi yalnizca redde anlamli; onayda eski gerekce temizlenir.
        redGerekce: durum === SaticiBelgeDurum.REDDEDILDI ? (gerekce ?? null) : null,
      },
    });
    const satici = await this.dogrulamaVerisiniTazele(belge.sellerId);
    return { belge: guncel, satici };
  }

  // ---------------- SATICI SOZLESMELERI ----------------
  //
  // Cekirdek SozlesmeService yeniden yazilmadi: zaten geneldi (userId + tip
  // aliyor, Load'a hicbir bagi yok). Eksik olan tek sey ERISIMDI - uclar
  // LoadController icindeydi ve o sinif @Roles(CARRIER, LOAD_CUSTOMER) ile
  // kilitli. O kilide DOKUNULMADI; satici icin market tarafinda kendi uclari
  // acildi (mevcut market deseni: izin tabanli).

  /**
   * SATICININ ONAYLAYABILECEGI TIPLER — beyaz liste.
   * Uc, SozlesmeTipi'nin tamamini kabul etseydi satici TASIYICI ya da
   * YUK_VEREN sozlesmesini onaylayabilirdi; onay kaydi hukuki kanit oldugu
   * icin bu ciddi bir kirlilik olurdu. Ayni beyaz liste deseni
   * MAGAZA_ROLU_IZIN_BEYAZ_LISTESI'nde de kullaniliyor.
   */
  private readonly SATICI_SOZLESMELERI: SozlesmeTipi[] = [
    SozlesmeTipi.SATICI,
    SozlesmeTipi.SATICI_KOMISYON,
  ];

  private saticiSozlesmesiMi(tip: SozlesmeTipi) {
    if (!this.SATICI_SOZLESMELERI.includes(tip)) {
      throw new BadRequestException(`Bu sözleşme tipi satıcı tarafına ait değil: ${tip}`);
    }
  }

  /**
   * Satici sozlesme durumu. Satici kaydi ARANIR: sozlesme satici sifatiyla
   * onaylanir, magaza personeli kendi adina onaylayamaz.
   *
   * Ilgili tip icin sozlesme_versiyonlari'nda aktif surum yoksa cekirdek
   * servis 503 doner - metin girisi ayri bir is (bkz. migration notu).
   */
  async saticiSozlesmeDurumu(userId: string, tip: SozlesmeTipi) {
    this.saticiSozlesmesiMi(tip);
    await this.saticimHam(userId);
    return this.sozlesme.durum(userId, tip);
  }

  /**
   * Satici sozlesme onayi. IP ve cihaz KANITTIR, istemciden degil sunucudan
   * alinir (load.controller'daki ayni desen). Cekirdek servis idempotent:
   * ayni surum ikinci kez onaylanirsa mevcut kayit doner.
   */
  async saticiSozlesmeOnayla(userId: string, tip: SozlesmeTipi, ip?: string, cihaz?: string) {
    this.saticiSozlesmesiMi(tip);
    await this.saticimHam(userId);
    return this.sozlesme.onayla(userId, tip, ip, cihaz);
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
