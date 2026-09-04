import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { BusinessUnit, Prisma, Role, SellerStatus, SellerVerification, SaticiBelgeTipi, SaticiBelgeDurum, SozlesmeTipi, OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { SellerStatusService } from './seller-status.service';
import { sifrele, son4 } from '../common/crypto/gizli-alan';
import { slugify, randomSuffix } from '../common/util/slug';
import { CreateStoreDto } from './dto/create-store.dto';
import { CalismaSaatleriDto } from './dto/calisma-saati.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { platformYoneticisi as platformYoneticisiKurali } from '../common/rbac/rol-kontrol';
import { DIKEY_DOMAIN } from '../common/domain/dikey-domain';

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

/**
 * Iki an arasindaki TAM GUN farki. Bekleme suresi "kac gundur" diye okunur,
 * saat/dakika artigi yuvarlanmaz - 0,9 gun bekleyen kayit "1 gundur bekliyor"
 * gibi gorunmesin diye asagi kirpilir. Negatif deger (ileri tarihli kayit)
 * 0'a sabitlenir.
 */
function gunFarki(baslangic: Date, simdi: Date): number {
  const fark = simdi.getTime() - baslangic.getTime();
  return fark <= 0 ? 0 : Math.floor(fark / 86400000);
}

/**
 * TIME kolonundan dakikaya. Sema Time(0) saklarken Prisma bunu 1970-01-01
 * tabanli bir Date'e cozer; kadran UTC parcalarinda durur (bkz. saatDate).
 */
function dakika(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "HH:MM" -> TIME kolonuna yazilacak Date. Kadran UTC parcalarina konur ki
 *  dakika() ile birebir geri okunsun. */
function saatDate(hhmm: string): Date {
  const [s, d] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, s, d, 0, 0));
}

/** TIME kolonundan "HH:MM". */
function saatMetni(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Bir araligi 0-1440 ekseninde PARCALARA acar. Gece yarisini asan aralik iki
 * parcaya bolunur (20:00-02:00 -> [1200,1440) + [0,120)); cakisma kontrolu
 * boylece duz aralik karsilastirmasina iner.
 */
/** "HH:MM" -> dakika. Bicim dogrulamasi DTO'da yapildi. */
function dakikaMetin(hhmm: string): number {
  const [sa, dk] = hhmm.split(':').map(Number);
  return sa * 60 + dk;
}

function parcalar(acilis: number, kapanis: number): [number, number][] {
  return acilis <= kapanis ? [[acilis, kapanis]] : [[acilis, 1440], [0, kapanis]];
}

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
    // SAHIPLIK KAPISI (degismedi): sahip | aktif personel | platform yoneticisi.
    // Donen satir ONCEKI hal - audit'te once/sonra icin EK SORGU GEREKMIYOR.
    const once = await this.ownedOrAdmin(storeId, userId, roles);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { ...dto };
    if (dto.minOrder !== undefined) data.minOrder = BigInt(dto.minOrder);
    const store = await this.prisma.store.update({ where: { id: storeId }, data });
    // AUDIT PR #16 DESENINE CEKILDI: kayit zaten vardi ama metadata BOSTU -
    // "magazada bir sey degisti" diyor, NE degistigini soylemiyordu.
    //
    // alanlar: istegin dokundugu alan adlari (seller.update ile ayni desen).
    // isActive ve minOrder icin ONCE/SONRA da yazilir; ikisi de is etkisi olan
    // alanlar (magazayi vitrinden dusurmek / siparis esigini degistirmek) ve
    // "kim, ne zaman, hangi degerden hangi degere" sorusu ancak boyle
    // cevaplanir. minOrder BigInt oldugu icin STRING yazilir - Prisma'nin Json
    // kolonu BigInt serilestiremez (bkz. catalog.controller audit basligi).
    await this.audit.record({
      actorId: userId, action: 'store.update', entity: 'Store', entityId: storeId, ip,
      metadata: {
        // TANIMSIZLARI ELE: UpdateStoreDto'da DOGRUDAN tanimli alan (isActive)
        // istekte gonderilmese bile Object.keys'te cikiyor (sinif alani olarak
        // undefined degeriyle var). Filtre olmasa audit "isActive degisti"
        // diyordu - yerel testte yakalandi.
        alanlar: Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined),
        ...(dto.isActive !== undefined
          ? { isActiveOnce: once.isActive, isActiveSonra: store.isActive }
          : {}),
        ...(dto.minOrder !== undefined
          ? { minOrderOnce: String(once.minOrder), minOrderSonra: String(store.minOrder) }
          : {}),
      },
    });
    return store;
  }

  // ---------------- SATICI (SELLER) ----------------

  /**
   * Kullanicinin satici kaydi. taxIdentifier COZULMEZ - yalnizca son 4 hane doner.
   *
   * ACIK BAYRAGI ADDITIVE: her magazaya `acik` eklendi (BR-014, acikMi).
   * Mevcut alanlarin HICBIRI degismedi, yalnizca yeni alan geldi - panel
   * "magaza su an acik mi" bilgisini ayri bir uc acmadan gorebilsin diye.
   *
   * N+1 BILEREK KABUL EDILDI: acikMi magaza basina bir store_hours sorgusu
   * yapiyor. Bir saticinin magaza sayisi tek haneli (canlida en fazla 5);
   * tek sorguya indirmek icin saat mantigini SQL'e tasimak, BR-014'un gece
   * yarisini asan mesai kuralini iki yerde tanimlamak demekti. Kural tek
   * yerde (acikMi) kaliyor.
   */
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

    const acikliklar = await Promise.all(s.stores.map((m) => this.acikMi(m.id)));
    return {
      ...s,
      stores: s.stores.map((m, i) => ({ ...m, acik: acikliklar[i] })),
      // DIKEY DOMAIN HARITASI YANITTA: panel "diger dikeylerinizde de magazaniz
      // var" baglantisini kurabilmek icin dikey -> host eslemesine ihtiyac
      // duyuyor. Haritayi panele KOPYALAMIYORUZ; dikey-domain.ts'in kendi
      // basligi "markali bir domain eklenir/kaldirilirsa IKISI BIRDEN
      // guncellenmelidir" diyor - ucuncu bir kopya o ikiliyi ucluye cikarir ve
      // ayrisma riskini artirirdi. Kaynak tek, panel tuketici.
      dikeyDomainleri: DIKEY_DOMAIN,
    };
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

    // HESAPLANMIS UYARI ALANLARI — SORGU ZAMANINDA, SALT OKUMA.
    // Hicbir kayit guncellenmez, hicbir otomatik aksiyon tetiklenmez; bu uc
    // alan yalnizca admin kuyrugunda "once hangisine bakmali" sorusuna yardim
    // eder. Saticinin gordugu hicbir uc bu hesaptan etkilenmez.
    const simdi = new Date();

    return {
      durum,
      toplam,
      kayitlar: kayitlar.map((k) => {
        // SURE HESABI DEPOLANAN DURUMA DEGIL CANLI TARIHE BAKAR.
        // verification alani "gecerli mi" sorusunun GUVENILIR cevabi degil:
        // tarihi gecmis bir kayit hala ONAYLANDI olarak duruyor olabilir
        // (asagidaki durumTutarsiz tam olarak bunu yakalar). Dogru olan
        // her istekte tarihi simdiyle karsilastirmak.
        const suresiGecti = !!k.verificationExpiresAt && k.verificationExpiresAt < simdi;
        return {
          ...k,
          // BELGE SURESI: satici_belgeleri'nde BELGE BASINA bitis tarihi ALANI
          // YOK (tip/dosyaUrl/durum/redGerekce + zaman damgalari). Platformda
          // "gecerlilik" tek yerde tutuluyor: Seller.verificationExpiresAt,
          // yani belgelerin onayiyla verilen dogrulamanin bitis tarihi. Bu alan
          // onu olcer. Belge basina son kullanma istenirse once semaya alan
          // eklenmeli.
          belgeSuresiGecti: suresiGecti,

          // DURUM TUTARSIZLIGI — OLU GECIS MANTIGININ IZI.
          // Depolanan dogrulama ONAYLANDI ("gecerli") diyor ama bitis tarihi
          // gecmis. Bu, kaydi SURESI_DOLDU'ya cekmesi gereken mekanizmanin ya
          // hic olmadigini ya da calismadigini gosterir. Alan bunu GORUNUR
          // kilar, hicbir seyi duzeltmez; degeri true olan kayit birikiyorsa
          // sorun mekanizmadadir, veride degil.
          //
          // BURADA SellerVerification.SURESI_DOLDU YAZILMIYOR — BILINCLI.
          // Bu bir GET ucu; salt okuma. Bir listeleme isteginin veriyi
          // duzeltmesi, admin listesini acan herkesin sessizce durum
          // degistirmesi demek olurdu (ve "kim degistirdi" sorusunun cevabi
          // olmazdi). Otomatik gecis AYRI bir karardir ve bu turun kapsami
          // disindadir.
          durumTutarsiz:
            k.verification === SellerVerification.ONAYLANDI && suresiGecti,

          // BEKLEME SURESI — KAYNAK updatedAt.
          //
          // SINIRLAMA ACIKCA BILINIYOR: Seller'da "UNDER_REVIEW'a gecti"
          // damgasi YOK, updatedAt ise HER yazmada tazeleniyor. Yani kayda
          // dokunan herhangi bir islem (belge onayi/reddi, unvan duzeltmesi,
          // dogrulama sonucu, admin durum degisikligi) sayaci SIFIRLAR ve
          // bekleme suresi OLDUGUNDAN KISA gorunur. Sayi "EN AZ bu kadar"
          // diye okunmalidir, kesin bekleme suresi degildir.
          //
          // Kesin olcum ancak ayri bir damga (or. incelemeyeGirdiAt) ya da
          // audit'teki seller.submit / seller.status kayitlarindan turetmekle
          // olur; ikisi de bu turun kapsami disinda.
          bekleyenGunSayisi:
            k.status === SellerStatus.UNDER_REVIEW ? gunFarki(k.updatedAt, simdi) : null,
        };
      }),
    };
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

  // ---------------- SATICI SIPARIS OZETI ----------------
  //
  // NEDEN BURADA, OrdersService'te DEGIL: OrdersModule zaten MarketModule'u
  // import ediyor (magaza erisim kurali orada tek kaynak). Ters yonde bir
  // import dairesel bagimlilik olurdu ve forwardRef gerektirirdi. Bu uc SALT
  // OKUMA raporlamadir; siparisin YASAM DONGUSU (durum gecisi, iptal, escrow)
  // OrdersService'te kalmaya devam eder - oraya dokunulmadi.
  //
  // /orders/store/:storeId ucundan FARKI ve varlik sebebi:
  //   1) Satici basina TEK cagri. Demo Market'in 5 magazasi var; eski ucla
  //      ekran 5 istek atmak zorundaydi.
  //   2) TOPLAMLAR SUNUCUDA, listeden BAGIMSIZ. Eski uc take:100 ile sinirli
  //      ve toplam donmuyordu; istemci 100 kaydi toplayinca hacim buyudugunde
  //      KPI'lar sessizce yanlislasirdi. Burada aggregate ayri kosar, sayfalama
  //      yalnizca listeyi etkiler.
  //   3) Tarih araligi filtresi (eski ucta yok).
  //
  // MAGAZA ERISIM DENETIMI GEREKMEZ: magaza kumesi kullanicinin KENDI satici
  // kaydindan turetiliyor, disaridan storeId alinmiyor. Baskasinin magazasini
  // sorgulamanin yolu yok.
  //
  //   4) DIKEY SUZGECI (q.dikey) — OPSIYONEL, verilmezse davranis DEGISMEZ.
  //      Suzgec MAGAZA KUMESINE uygulanir, siparis satirina degil: bir magaza
  //      tek bir dikeye ait oldugu icin sonuc ayni, ama tek yerde durur ve
  //      magazalar[] kirilimi de kendiliginden daralir. Toplamlar ayni where'i
  //      paylastigi icin filtreli kumeye gore cikar - istemcinin toplam
  //      hesaplamasina hic gerek kalmaz.
  async saticiSiparisleri(
    userId: string,
    q: {
      from?: string;
      to?: string;
      status?: OrderStatus;
      dikey?: BusinessUnit;
      q?: string;
      skip?: number;
      take?: number;
    },
  ) {
    const satici = await this.saticimHam(userId);

    const magazalar = await this.prisma.store.findMany({
      where: { sellerId: satici.id, deletedAt: null, ...(q.dikey ? { businessUnit: q.dikey } : {}) },
      select: { id: true, name: true, businessUnit: true },
    });
    const magazaIdleri = magazalar.map((m) => m.id);

    // Saticinin hic magazasi yoksa siparis de yoktur: bos ozet don, sorgu acma.
    if (magazaIdleri.length === 0) {
      return {
        aralik: { from: q.from ?? null, to: q.to ?? null },
        dikey: q.dikey ?? null,
        toplam: { siparisSayisi: 0, ciro: 0n, komisyon: 0n, hakedis: 0n },
        durumDagilimi: {} as Record<string, number>,
        magazalar: [],
        kayitlar: [],
      };
    }

    const placedAt =
      q.from || q.to
        ? { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) }
        : undefined;

    // Bos/whitespace arama YOK SAYILIR: additive, q verilmezse davranis birebir.
    const arama = q.q?.trim();

    const where: Prisma.OrderWhereInput = {
      storeId: { in: magazaIdleri },
      deletedAt: null,
      ...(placedAt ? { placedAt } : {}),
      ...(q.status ? { status: q.status } : {}),
      // Siparis no VEYA musteri adi/soyadi. Tek where'de yasadigi icin dort
      // sorgu (aggregate/groupBy/groupBy/findMany) da ayni daralmayi gorur.
      ...(arama
        ? {
            OR: [
              { orderNo: { contains: arama, mode: 'insensitive' } },
              { user: { OR: [
                { name: { contains: arama, mode: 'insensitive' } },
                { surname: { contains: arama, mode: 'insensitive' } },
              ] } },
            ],
          }
        : {}),
    };

    const take = Math.min(Math.max(1, q.take ?? 50), 100);
    const skip = Math.max(0, q.skip ?? 0);

    // GUN SERISI icin ham SQL: Prisma groupBy date_trunc desteklemedigi icin
    // $queryRaw. Filtreler yukaridaki `where` ile AYNI DEGERLERDEN turetilir
    // (magazaIdleri / placedAt / status / arama) - ayni guvenlik ve daralma
    // kapsami. arama'da ILIKE, Prisma contains+insensitive'e denk; %/_/\ escape
    // edilir ki gun serisi listeyle BIREBIR ayni suzulsun (Prisma contains ozel
    // karakterleri literal alir, ham ILIKE ise wildcard sayardi).
    const rawKosullar: Prisma.Sql[] = [
      Prisma.sql`o."storeId" IN (${Prisma.join(magazaIdleri.map((id) => Prisma.sql`${id}::uuid`))})`,
      Prisma.sql`o."deletedAt" IS NULL`,
    ];
    if (q.from) rawKosullar.push(Prisma.sql`o."placedAt" >= ${new Date(q.from)}`);
    if (q.to) rawKosullar.push(Prisma.sql`o."placedAt" <= ${new Date(q.to)}`);
    if (q.status) rawKosullar.push(Prisma.sql`o.status = ${q.status}::"OrderStatus"`);
    if (arama) {
      const like = `%${arama.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
      rawKosullar.push(
        Prisma.sql`(o."orderNo" ILIKE ${like} ESCAPE '\\' OR u."name" ILIKE ${like} ESCAPE '\\' OR u."surname" ILIKE ${like} ESCAPE '\\')`,
      );
    }

    const [toplamlar, durumlar, magazaKirilimi, kayitlar, gunlukSeri] = await this.prisma.$transaction([
      this.prisma.order.aggregate({
        where,
        _count: { _all: true },
        _sum: { total: true, commission: true, netRevenue: true },
      }),
      // _count: true -> dogrudan sayi doner. orderBy bu Prisma surumunde
      // groupBy icin ZORUNLU; siralamanin sonuca etkisi yok, gruplari
      // deterministik sirada almak icin veriliyor.
      this.prisma.order.groupBy({ by: ['status'], where, _count: true, orderBy: { status: 'asc' } }),
      this.prisma.order.groupBy({ by: ['storeId'], where, _count: true, orderBy: { storeId: 'asc' } }),
      this.prisma.order.findMany({
        where,
        orderBy: { placedAt: 'desc' },
        skip,
        take,
        include: { items: { include: { secimler: true } } },
      }),
      // 5. sorgu - GUN SERISI: gun basina adet + ciro. Ayni $transaction icinde
      // diger dortyle tutarli kar. adet::int -> number, ciro::bigint -> BigInt
      // (main.ts toJSON ile JSON'a string), gun -> Date (JSON'a ISO string).
      this.prisma.$queryRaw<Array<{ gun: Date; adet: number; ciro: bigint }>>(Prisma.sql`
        SELECT date_trunc('day', o."placedAt") AS gun,
               count(*)::int AS adet,
               COALESCE(sum(o.total), 0)::bigint AS ciro
        FROM orders o
        JOIN users u ON u.id = o."userId"
        WHERE ${Prisma.join(rawKosullar, ' AND ')}
        GROUP BY 1
        ORDER BY 1
      `),
    ]);

    const sayimlar = new Map(magazaKirilimi.map((g) => [g.storeId, g._count]));

    return {
      aralik: { from: q.from ?? null, to: q.to ?? null },
      // Uygulanan suzgec yanitta ECHO edilir: istemci ne suzuldugunu gorebilsin.
      dikey: q.dikey ?? null,
      // BigInt'ler main.ts'teki toJSON yamasi sayesinde JSON'a STRING cikar.
      // _sum kayit yoksa null doner; 0'a indiriliyor ki istemci null gormesin.
      toplam: {
        siparisSayisi: toplamlar._count._all,
        ciro: toplamlar._sum.total ?? 0n,
        komisyon: toplamlar._sum.commission ?? 0n,
        hakedis: toplamlar._sum.netRevenue ?? 0n,
      },
      durumDagilimi: Object.fromEntries(durumlar.map((g) => [g.status, g._count])),
      magazalar: magazalar.map((m) => ({ ...m, siparisSayisi: sayimlar.get(m.id) ?? 0 })),
      kayitlar,
      // ADDITIVE: gun basina { gun, adet, ciro }. Diger alanlarin hicbiri
      // degismedi. Bos aralikta bos dizi doner.
      gunlukSeri,
    };
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
   * magazalarin hepsi kapanirdi (hicbirinde saat kaydi yok).
   * Ayni gun icin birden fazla gecerli SURUM varsa EN YENI effectiveFrom kazanir
   * (sezonluk saat eskisinin uzerine yazmadan tanimlanabilsin).
   *
   * SAAT DILIMI — KAYITLAR TURKIYE DUVAR SAATIDIR. Sunucu UTC calisiyor
   * (Railway konteynerinde TZ ayarli degil; 00:17 TR'deki deploy'un logu
   * 21:17 damgali). Eski hal kayitli saati getUTCHours ile okuyup SUNUCU YEREL
   * saatiyle karsilastiriyordu: satici "09:00-18:00" yazsa magaza canlida
   * 12:00-21:00 TR arasi acik gorunurdu - 3 saat kayma. Simdi "simdi" TR'ye
   * cevriliyor. Turkiye KALICI UTC+3 (yaz saati uygulamasi yok), o yuzden tek
   * sabit yeterli; kutuphane/veritabani TZ ayari gerekmiyor.
   *
   * GUN SECIMI DE TR'YE GORE: 01:00 TR = 22:00 UTC, yani UTC'ye gore gun
   * ONCEKI gundur. Bu cevrilmezse gece yarisindan sonra yanlis gunun saatleri
   * okunurdu.
   *
   * COKLU ARALIK: bir gun birden fazla satirla temsil edilebiliyor (ogle
   * arasi). Herhangi bir satir isClosed ise gun kapali; degilse ARALIKLARDAN
   * HERHANGI BIRI kapsiyorsa acik (OR).
   *
   * BILINEN SINIR — ONCEKI GUNDEN TASAN ARALIK: yalnizca BUGUNUN satirlarina
   * bakilir. Cuma 20:00-02:00 tanimliysa Cumartesi 01:00'de Cumartesi'nin
   * satirlari okunur; Cumartesi'de de gece asan bir aralik varsa dogru sonuc
   * cikar, yoksa "kapali" denir. Eski davranis da boyleydi; degistirmek her
   * kontrolde ikinci bir gun sorgusu demek - ayri karar olarak birakildi.
   */
  // ---------------- CALISMA SAATLERI ----------------

  /**
   * HAFTALIK PROGRAM (okuma). Yetki magaza guncellemeyle AYNI kapidan:
   * ownedOrAdmin (sahip | magaza kapsamli rol | platform yoneticisi).
   *
   * Kaydi olmayan gun "acik" demektir (BR-014); yanit yine 7 gun dondurur ve o
   * gunler isClosed:false + bos aralik olarak gorunur - panel formu "eksik gun"
   * diye bir durumla ugrasmasin.
   */
  async calismaSaatleri(storeId: string, userId: string, roles: Role[]) {
    await this.ownedOrAdmin(storeId, userId, roles);
    return this.calismaSaatleriOku(storeId);
  }

  /** Yetki kontrolu YAPMAZ - cagiran taraf zaten yapti (okuma + audit ortak yolu). */
  private async calismaSaatleriOku(storeId: string) {
    const bugun = this.trBugun();
    const satirlar = await this.prisma.storeHour.findMany({
      where: {
        storeId,
        effectiveFrom: { lte: bugun },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: bugun } }],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { weekday: 'asc' }, { sequence: 'asc' }],
    });
    // Gun basina YALNIZCA en yeni surum - acikMi ile ayni secim kurali.
    const enYeni = new Map<number, Date>();
    for (const k of satirlar) if (!enYeni.has(k.weekday)) enYeni.set(k.weekday, k.effectiveFrom);

    const gunler = [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
      const surum = enYeni.get(weekday);
      const gunSatirlari = surum
        ? satirlar.filter((k) => k.weekday === weekday && k.effectiveFrom.getTime() === surum.getTime())
        : [];
      const kapali = gunSatirlari.some((k) => k.isClosed);
      return {
        weekday,
        isClosed: kapali,
        araliklar: kapali
          ? []
          : gunSatirlari
              .filter((k) => k.openTime !== null && k.closeTime !== null)
              .map((k) => ({
                openTime: saatMetni(k.openTime as Date),
                closeTime: saatMetni(k.closeTime as Date),
              })),
      };
    });
    return { storeId, gunler };
  }

  /** Turkiye gununun tarihi (UTC gece yarisi) - DATE kolonu kiyaslari icin. */
  private trBugun(an: Date = new Date()): Date {
    const tr = MarketService.trAn(an);
    return new Date(Date.UTC(tr.getUTCFullYear(), tr.getUTCMonth(), tr.getUTCDate()));
  }

  /**
   * HAFTALIK PROGRAMI YAZ (7 gun, tek transaction).
   *
   * ATOMIK DEGISTIRME: ayni effectiveFrom icin eski satirlar SILINIP yenileri
   * yaziliyor (deleteMany + createMany, tek transaction). Upsert secilmedi
   * cunku coklu aralikta gun basina SATIR SAYISI degisebiliyor - iki aralikli
   * bir gun tek araliga inince artik satir kalirdi.
   *
   * SURUMLEME: effectiveFrom verilmezse BUGUN. Ayni gun tekrar kaydetmek ayni
   * surumu gunceller; baska bir gun kaydetmek YENI surum yaratir ve acikMi en
   * yenisini secer - gecmis program silinmeden tarihce olusur.
   */
  async calismaSaatleriGuncelle(
    storeId: string,
    userId: string,
    roles: Role[],
    dto: CalismaSaatleriDto,
    ip?: string,
  ) {
    await this.ownedOrAdmin(storeId, userId, roles);

    const bugun = this.trBugun();
    const effectiveFrom = dto.effectiveFrom
      ? new Date(dto.effectiveFrom.slice(0, 10) + 'T00:00:00.000Z')
      : bugun;
    if (Number.isNaN(effectiveFrom.getTime())) throw new BadRequestException('effectiveFrom gecersiz');
    if (effectiveFrom < bugun) {
      throw new BadRequestException('effectiveFrom gecmis bir tarih olamaz');
    }

    const gunler = this.calismaSaatleriDogrula(dto);
    const once = await this.calismaSaatleriOku(storeId);

    const satirlar: Prisma.StoreHourCreateManyInput[] = gunler.flatMap(
      (g): Prisma.StoreHourCreateManyInput[] =>
      g.isClosed
        ? [{
            storeId, weekday: g.weekday, sequence: 0, isClosed: true,
            openTime: null, closeTime: null, effectiveFrom,
          }]
        : g.araliklar.map((a, i) => ({
            storeId, weekday: g.weekday, sequence: i, isClosed: false,
            openTime: saatDate(a.openTime), closeTime: saatDate(a.closeTime), effectiveFrom,
          })),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.storeHour.deleteMany({ where: { storeId, effectiveFrom } });
      await tx.storeHour.createMany({ data: satirlar });
    });

    const sonra = await this.calismaSaatleriOku(storeId);

    // AUDIT (PR #22 deseni): yalnizca DEGISEN gunler yazilir - 7 gunun tamamini
    // her kayitta yazmak audit'i gurultuye bogardi. Once/sonra icin EK SORGU
    // acilmadi; iki okuma zaten yapiliyor.
    const ozet = (g: { isClosed: boolean; araliklar: { openTime: string; closeTime: string }[] }) =>
      g.isClosed ? 'KAPALI' : g.araliklar.map((a) => a.openTime + '-' + a.closeTime).join(', ');
    const degisen = sonra.gunler
      .map((g, i) => ({ weekday: g.weekday, once: ozet(once.gunler[i]), sonra: ozet(g) }))
      .filter((d) => d.once !== d.sonra);

    await this.audit.record({
      actorId: userId, action: 'store.hours.update', entity: 'Store', entityId: storeId, ip,
      metadata: {
        effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
        degisenGunler: degisen.map((d) => d.weekday),
        degisiklikler: degisen,
      },
    });

    return {
      ...sonra,
      effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
      // SU AN ACIK MI: satici yanlis saat kaydettigini siparis reddiyle
      // (MAGAZA_KAPALI) degil, formda ANINDA gorsun.
      suAnAcik: await this.acikMi(storeId),
    };
  }

  /**
   * IS KURALLARI (DTO'da ifade edilemeyenler):
   *  - 7 gun de TAM OLARAK bir kez gonderilmeli
   *  - kapali gunde aralik OLMAMALI, acik gunde EN AZ BIR aralik
   *  - openTime === closeTime YASAK: sifir uzunluk mu 24 saat mi belirsiz
   *  - AYNI GUNUN ARALIKLARI CAKISAMAZ (gece yarisini asan aralik dahil)
   */
  private calismaSaatleriDogrula(dto: CalismaSaatleriDto) {
    const gunler = [...dto.gunler].sort((a, b) => a.weekday - b.weekday);
    if (new Set(gunler.map((g) => g.weekday)).size !== 7) {
      throw new BadRequestException('Haftanin 7 gunu de tam olarak bir kez gonderilmeli');
    }
    for (const g of gunler) {
      if (g.isClosed) {
        if (g.araliklar.length > 0) {
          throw new BadRequestException('Kapali gun icin aralik gonderilemez (gun ' + g.weekday + ')');
        }
        continue;
      }
      if (g.araliklar.length === 0) {
        throw new BadRequestException('Acik gun en az bir aralik ister (gun ' + g.weekday + ')');
      }
      const parcaListesi = g.araliklar.map((a) => {
        const acilis = dakikaMetin(a.openTime);
        const kapanis = dakikaMetin(a.closeTime);
        if (acilis === kapanis) {
          throw new BadRequestException(
            'Acilis ve kapanis ayni olamaz (gun ' + g.weekday + ', ' + a.openTime +
              '). 24 saat acik icin 00:00-23:59 girin.',
          );
        }
        return parcalar(acilis, kapanis);
      });
      // CAKISMA: her aralik parcalara acilir (gece yarisini asan aralik ikiye
      // bolunur), sonra ikili karsilastirilir - kural tek bicimde uygulanir.
      for (let i = 0; i < parcaListesi.length; i++) {
        for (let j = i + 1; j < parcaListesi.length; j++) {
          for (const [a1, b1] of parcaListesi[i]) {
            for (const [a2, b2] of parcaListesi[j]) {
              if (a1 < b2 && a2 < b1) {
                throw new BadRequestException(
                  'Ayni gunun araliklari cakisiyor (gun ' + g.weekday + '): ' +
                    g.araliklar[i].openTime + '-' + g.araliklar[i].closeTime + ' ve ' +
                    g.araliklar[j].openTime + '-' + g.araliklar[j].closeTime,
                );
              }
            }
          }
        }
      }
    }
    return gunler;
  }

  private static readonly TR_OFSET_DK = 180; // UTC+3, kalici

  /** Bir Date'i Turkiye duvar saatine tasir; parcalar getUTC* ile okunur. */
  private static trAn(an: Date): Date {
    return new Date(an.getTime() + MarketService.TR_OFSET_DK * 60_000);
  }

  async acikMi(storeId: string, an: Date = new Date()): Promise<boolean> {
    const tr = MarketService.trAn(an);
    const gun = tr.getUTCDay();
    const bugun = new Date(Date.UTC(tr.getUTCFullYear(), tr.getUTCMonth(), tr.getUTCDate()));
    const simdi = tr.getUTCHours() * 60 + tr.getUTCMinutes();

    // 1) GECERLI SURUM: en yeni effectiveFrom.
    const surum = await this.prisma.storeHour.findFirst({
      where: {
        storeId,
        weekday: gun,
        effectiveFrom: { lte: bugun },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: bugun } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      select: { effectiveFrom: true },
    });
    if (!surum) return true;

    // 2) O SURUMUN TUM ARALIKLARI (coklu aralik).
    const satirlar = await this.prisma.storeHour.findMany({
      where: { storeId, weekday: gun, effectiveFrom: surum.effectiveFrom },
      orderBy: { sequence: 'asc' },
      select: { isClosed: true, openTime: true, closeTime: true },
    });
    // Kapali gun TEK satirdir; yine de savunmaci: bir satir bile kapali diyorsa kapali.
    if (satirlar.some((k) => k.isClosed)) return false;

    return satirlar.some((k) => {
      if (!k.openTime || !k.closeTime) return false; // yarim kayit -> kapsamiyor
      const acilis = dakika(k.openTime);
      const kapanis = dakika(k.closeTime);
      // Gece yarisini asan mesai (or. 20:00 - 02:00) tek araliga sigmaz.
      return acilis <= kapanis ? simdi >= acilis && simdi < kapanis : simdi >= acilis || simdi < kapanis;
    });
  }

  async assertOwner(storeId: string, userId: string, roles: Role[]) {
    return this.ownedOrAdmin(storeId, userId, roles);
  }
}
