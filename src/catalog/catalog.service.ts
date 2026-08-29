import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { BusinessUnit, Prisma, Role, SellerStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MarketService } from '../market/market.service';
import { slugify, randomSuffix } from '../common/util/slug';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import {
  VaryantOlusturDto, VaryantGuncelleDto, SecenekGrubuDto, SecenekDto,
  UrunSecenekGruplariDto, MedyaEkleDto, MedyaGuncelleDto,
} from './dto/varyant.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { vitrinFiyatHesapla, kdvOraniBul, ekUcretHesapla } from '../delivery/pricing';
import { etkinFiyat, etkinStok } from '../common/domain/varyant';

// VITRINDE GORUNEN SECENEK YAPISI — okuma uclarinin ortak include'u.
// Yalnizca AKTIF grup ve AKTIF secenek doner: sepet dogrulamasi da tam olarak
// bunu suzuyor (cart.secimleriCoz), dolayisiyla vitrinde gorunen her secenek
// sepete eklenebilir. Siralama urun<->grup baginin sortOrder'i: ayni grup iki
// urunde farkli sirada durabilsin.
const VITRIN_SECENEKLERI = Prisma.validator<Prisma.Product$secenekGruplariArgs>()({
  where: { group: { isActive: true } },
  orderBy: { sortOrder: 'asc' },
  include: {
    group: {
      select: {
        id: true,
        name: true,
        minSecim: true,
        maxSecim: true,
        zorunlu: true,
        options: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, ekUcret: true, sortOrder: true },
        },
      },
    },
  },
});

// MUSTERIYE ACIK URUN ALANLARI — IZIN LISTESI (denylist DEGIL).
//
// Bu ucler ham Prisma satirini donduruyordu; projede yanit DTO'su yok
// (ClassSerializerInterceptor / @Exclude hicbir yerde kullanilmiyor), yani
// "yanit sekli" = tablo semasi. Sonuc: products'a bir muhasebe kolonu eklendigi
// anda public uc onu KENDILIGINDEN yayinliyordu - netFiyat, komisyonTutari,
// kargoTutari, malKdvTutari, hizmetKdvTutari boyle disari cikti.
//
// Cozum izin listesi: varsayilan GIZLI. Yeni kolon buraya acikca yazilmadikca
// musteriye gitmez. Bedeli: vitrinde gorunmesi gereken yeni bir alan eklenince
// bu liste de guncellenmeli.
//
// Kirilimi GOREN yollar bilerek ayri metotlarda: listPending / createProduct /
// updateProduct / approve / reject - hepsi assertOwner ya da PermissionsGuard
// arkasinda. Onaylanmis urunun tam satiri icin urunDetay ucu var.
const VITRIN_URUN_ALANLARI = Prisma.validator<Prisma.ProductSelect>()({
  id: true,
  storeId: true,
  categoryId: true,
  name: true,
  slug: true,
  description: true,
  sku: true,
  imageUrl: true,
  price: true, // musteriye giden TEK fiyat: vitrin fiyati (kirilim gomulu)
  currency: true,
  stock: true,
  unit: true,
  desi: true,
  weightKg: true,
  kdvOrani: true,
  // satisModeli (A=kendi urun / B=dropshipping) BILEREK YOK: kirilim degil ama
  // is modeli bilgisi, musteriyi ilgilendirmez. Fiyat hattinda kullanildigi
  // yerlerin hepsi satici/yonetim yolu ve tam satiri okuyor (getProduct).
  barcode: true,
  shortDescription: true,
  productType: true,
  unitType: true,
  minimumQuantity: true,
  quantityStep: true,
  preparationTimeMinutes: true,
  masterProductId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

// VITRINDE GORUNEN VARYANTLAR — burada da IZIN LISTESI.
// ProductVariant'ta da muhasebe kolonlari var (netFiyat / komisyonTutari /
// kargoTutari / malKdvTutari / hizmetKdvTutari); include ile eklemek, urun
// tarafinda kapatilan sizintiyi varyant tarafindan geri acardi.
// Suzme sepet dogrulamasiyla AYNI (isActive + deletedAt): vitrinde gorunen her
// varyant sepete eklenebilir.
const VITRIN_VARYANTLAR = Prisma.validator<Prisma.Product$varyantlarArgs>()({
  where: { isActive: true, deletedAt: null },
  orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  select: { id: true, name: true, sku: true, barcode: true, sortOrder: true, price: true, stock: true },
});

type VitrinVaryant = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  sortOrder: number;
  price: bigint | null;
  stock: number | null;
};

type VitrinSecenekBagi = {
  sortOrder: number;
  group: {
    id: string;
    name: string;
    minSecim: number;
    maxSecim: number;
    zorunlu: boolean;
    options: { id: string; name: string; ekUcret: bigint; sortOrder: number }[];
  };
};

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

  /**
   * SECENEKLERI MUSTERI FIYATIYLA DONDURUR — vitrin uclarinin TEK YERI.
   *
   * Carsi'da Option.ekUcret SATICININ NETIDIR; musterinin odeyecegi tutar
   * komisyon + mal KDV + hizmet KDV eklenerek uretilir. Ikinci bir fiyat
   * formulu YAZILMADI: sepet de (cart.secimleriCoz) ayni ekUcretHesapla'yi
   * cagiriyor, dolayisiyla vitrinde gorulen ile sepette odenen ayrisamaz.
   * Ham ekUcret disariya hicbir kosulda cikmaz.
   *
   * Carsi disi dikeylerde ekUcret zaten satis tutaridir, oldugu gibi doner.
   */
  private secenekleriVitrine(
    urun: { kdvOrani: number },
    magaza: { businessUnit: BusinessUnit; commissionRate: number },
    baglar: VitrinSecenekBagi[],
  ) {
    const carsi = magaza.businessUnit === BusinessUnit.CARSI;
    const komisyonOran = BigInt(magaza.commissionRate) / 100n;
    return baglar.map((b) => ({
      id: b.group.id,
      name: b.group.name,
      minSecim: b.group.minSecim,
      maxSecim: b.group.maxSecim,
      zorunlu: b.group.zorunlu,
      sortOrder: b.sortOrder,
      secenekler: b.group.options.map((o) => ({
        id: o.id,
        name: o.name,
        // MUSTERI FIYATI (kurus). Istemci bunu oldugu gibi gosterir ve
        // sepete optionId gonderir; ceviriyi tekrar yapmasi gerekmez.
        ekUcret: carsi
          ? ekUcretHesapla(o.ekUcret, urun.kdvOrani, komisyonOran).vitrinKurus
          : o.ekUcret,
        sortOrder: o.sortOrder,
      })),
    }));
  }

  /**
   * VARYANTLARI ETKIN FIYAT/STOKLA DONDURUR.
   *
   * Varyantta price/stock NULL olabilir - "urunun degeri gecerli" demektir.
   * Ikinci bir cozum yazilmadi: sepet ve checkout ile AYNI kaynak
   * (common/domain/varyant.etkinFiyat / etkinStok) cagriliyor, dolayisiyla
   * vitrinde gorulen fiyat ile sepete yazilan fiyat ayrisamaz.
   *
   * STOGU 0 OLAN VARYANT GIZLENMEZ, stok:0 ile doner. Gizlenseydi tum
   * varyantlari tukenmis bir urun "varyantsiz" gibi gorunur ve istemci
   * varyantsiz kalem eklerdi.
   */
  private varyantlariVitrine(urun: { price: bigint; stock: number }, varyantlar: VitrinVaryant[]) {
    return varyantlar.map((v) => {
      const fiyat = etkinFiyat(urun, v);
      return {
        id: v.id,
        name: v.name,
        sku: v.sku,
        barcode: v.barcode,
        sortOrder: v.sortOrder,
        fiyat, // musterinin bu varyant icin odeyecegi tutar (kurus)
        // Istemci "+15 TL" gosterebilsin diye hazir fark. Negatif olabilir:
        // kucuk boy urunun kendi fiyatinin altinda olabilir.
        fiyatFarki: fiyat - urun.price,
        stok: etkinStok(urun, v),
      };
    });
  }

  /**
   * Ham urun kaydini vitrin gorunumune cevirir. store BILEREK cikariliyor:
   * yalnizca secenek fiyatlandirmasi icin okundu, yanitin sekli degismesin.
   */
  private vitrinUrun<
    T extends {
      price: bigint;
      stock: number;
      kdvOrani: number;
      store: { businessUnit: BusinessUnit; commissionRate: number };
      secenekGruplari: VitrinSecenekBagi[];
      varyantlar: VitrinVaryant[];
    },
  >(kayit: T) {
    const { store, secenekGruplari, varyantlar, ...urun } = kayit;
    return {
      ...urun,
      varyantlar: this.varyantlariVitrine(urun, varyantlar),
      secenekGruplari: this.secenekleriVitrine(urun, store, secenekGruplari),
    };
  }

  async listProducts(storeId: string, categoryId?: string, skip = 0, take = 50) {
    const kayitlar = await this.prisma.product.findMany({
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
      select: {
        ...VITRIN_URUN_ALANLARI,
        // Menu ekrani: restoran vitrininde varyant ve secenekler urunle birlikte
        // gorunur, istemci her urun icin ayri detay cagrisi yapmak zorunda kalmasin.
        store: { select: { businessUnit: true, commissionRate: true } },
        varyantlar: VITRIN_VARYANTLAR,
        secenekGruplari: VITRIN_SECENEKLERI,
      },
    });
    return kayitlar.map((u) => this.vitrinUrun(u));
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
      select: {
        ...VITRIN_URUN_ALANLARI,
        store: { select: { businessUnit: true, commissionRate: true } },
        varyantlar: VITRIN_VARYANTLAR,
        secenekGruplari: VITRIN_SECENEKLERI,
      },
    });
    if (!product) throw new NotFoundException('Urun bulunamadi');
    return this.vitrinUrun(product);
  }

  /**
   * SATICI URUN DETAYI — kirilimi goren tek tekil-urun ucu.
   *
   * getPublicProduct artik muhasebe alanlarini dondurmuyor; onaylanmis bir
   * urunun net fiyatini/komisyonunu okumanin baska yolu kalmamisti (listPending
   * yalnizca isActive:false olanlari veriyor). Duzenleme ekraninin formu net
   * fiyati bos doldurmasin diye bu uc acildi. Yetki her yerdeki ayni kapidan:
   * market.assertOwner (sahip | aktif personel | platform yoneticisi).
   */
  async urunDetay(id: string, userId: string, roles: Role[]) {
    const urun = await this.getProduct(id); // yayinda olmayani da bulur
    await this.market.assertOwner(urun.storeId, userId, roles);
    return urun;
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

  // ============================================================
  // FAZ 3 / ADIM 2.5 — KATALOG YAZMA UCLARI
  // Varyant, secenek grubu, secenek ve medya yonetimi.
  // Yetki her yerde AYNI KAPIDAN: market.assertOwner (sahip | aktif personel |
  // platform yoneticisi). Id ile gelen kayitlarda once magaza cozulur.
  // ============================================================

  /**
   * CARSI FIYATLANDIRMASI VARYANT BASINA.
   * Carsi'da kargo + komisyon + KDV urun fiyatina GOMULU; satici NET fiyat
   * verir, vitrin fiyati ve muhasebe kirilimi uretilir. createProduct'taki
   * desenin aynisi - ikinci bir formul yazilmadi, ayni vitrinFiyatHesapla
   * cagriliyor. Carsi disinda price dogrudan satis fiyatidir ve kirilim NULL
   * kalir (etkinKirilim o durumda urunun kirilimina duser).
   */
  private varyantFiyatAlanlari(
    store: { businessUnit: BusinessUnit; commissionRate: number },
    urun: { kdvOrani: number; desi: number; weightKg: number; satisModeli: string },
    dto: VaryantOlusturDto | VaryantGuncelleDto,
  ) {
    if (store.businessUnit !== BusinessUnit.CARSI) {
      return dto.price !== undefined ? { price: BigInt(dto.price) } : {};
    }
    const netKurus = BigInt(dto.netFiyat ?? dto.price ?? 0);
    if (netKurus <= 0n) throw new BadRequestException('Carsi varyantinda net fiyat zorunlu');
    const hesap = vitrinFiyatHesapla(
      netKurus,
      dto.desi ?? urun.desi,
      dto.weightKg ?? urun.weightKg,
      dto.satisModeli ?? urun.satisModeli,
      dto.kdvOrani ?? urun.kdvOrani,
      BigInt(store.commissionRate) / 100n,
    );
    if (!hesap.ok) throw new BadRequestException(hesap.sebep);
    return {
      price: hesap.vitrinKurus,
      netFiyat: netKurus,
      komisyonTutari: hesap.komisyonKurus,
      // yuvarlama farki kargoya - urun tarafiyla ayni kural
      kargoTutari: hesap.kargoKurus + hesap.yuvarlamaKurus,
      malKdvTutari: hesap.malKdvKurus,
      hizmetKdvTutari: hesap.hizmetKdvKurus,
    };
  }

  private async urunVeMagaza(productId: string, userId: string, roles: Role[]) {
    const urun = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: { store: { select: { id: true, businessUnit: true, commissionRate: true } } },
    });
    if (!urun) throw new NotFoundException('Urun bulunamadi');
    await this.market.assertOwner(urun.storeId, userId, roles);
    return urun;
  }

  // ---------------- VARYANT ----------------

  async varyantListesi(productId: string, userId: string, roles: Role[]) {
    await this.urunVeMagaza(productId, userId, roles);
    return this.prisma.productVariant.findMany({
      where: { productId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async varyantOlustur(productId: string, userId: string, roles: Role[], dto: VaryantOlusturDto) {
    const urun = await this.urunVeMagaza(productId, userId, roles);
    const cakisma = await this.prisma.productVariant.findFirst({ where: { productId, name: dto.name } });
    if (cakisma) throw new ConflictException('Bu isimde bir varyant zaten var');
    return this.prisma.productVariant.create({
      data: {
        productId,
        name: dto.name,
        sku: dto.sku,
        barcode: dto.barcode,
        // null birakilirsa stok urun duzeyinde tutulur (etkinStok urune duser)
        stock: dto.stock ?? null,
        sortOrder: dto.sortOrder ?? 0,
        ...this.varyantFiyatAlanlari(urun.store, urun, dto),
      },
    });
  }

  async varyantGuncelle(variantId: string, userId: string, roles: Role[], dto: VaryantGuncelleDto) {
    const varyant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, deletedAt: null },
      include: {
        product: { include: { store: { select: { businessUnit: true, commissionRate: true } } } },
      },
    });
    if (!varyant) throw new NotFoundException('Varyant bulunamadi');
    await this.market.assertOwner(varyant.product.storeId, userId, roles);

    // Fiyat girdisi GELDIYSE yeniden hesaplanir; gelmediyse mevcut degerlere
    // dokunulmaz - kismi guncellemede fiyat sessizce sifirlanmasin.
    const fiyatGirdisiVar =
      dto.price !== undefined || dto.netFiyat !== undefined || dto.desi !== undefined ||
      dto.weightKg !== undefined || dto.kdvOrani !== undefined || dto.satisModeli !== undefined;

    return this.prisma.productVariant.update({
      where: { id: variantId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
        ...(dto.barcode !== undefined ? { barcode: dto.barcode } : {}),
        ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        // BACKLOG: isActive'i satici assertOwner ile yaziyor, onay kapisi yok.
        // Gerekce ve karar secenekleri: dto/varyant.dto.ts, VaryantGuncelleDto ustu.
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(fiyatGirdisiVar
          ? this.varyantFiyatAlanlari(varyant.product.store, varyant.product, dto)
          : {}),
      },
    });
  }

  // SOFT DELETE: sepette ve gecmis siparislerde referansi olabilir; sert silme
  // gecmisi bozar (OrderItem.variantId'ye FK koymamamizla ayni gerekce).
  async varyantSil(variantId: string, userId: string, roles: Role[]) {
    const varyant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, deletedAt: null },
      include: { product: { select: { storeId: true } } },
    });
    if (!varyant) throw new NotFoundException('Varyant bulunamadi');
    await this.market.assertOwner(varyant.product.storeId, userId, roles);
    await this.prisma.productVariant.update({
      where: { id: variantId },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { deleted: true };
  }

  // ---------------- SECENEK GRUBU VE SECENEKLER ----------------

  // min > max mantiksal olarak imkansiz; zorunlu grupta min en az 1 olmali,
  // yoksa "zorunlu" bilgisi hicbir sey ifade etmez.
  private secimSiniriDogrula(min: number, max: number, zorunlu: boolean) {
    if (min > max) throw new BadRequestException('minSecim maxSecim degerinden buyuk olamaz');
    if (zorunlu && min < 1) throw new BadRequestException('Zorunlu grupta minSecim en az 1 olmali');
  }

  async secenekGruplari(storeId: string, userId: string, roles: Role[]) {
    await this.market.assertOwner(storeId, userId, roles);
    return this.prisma.optionGroup.findMany({
      where: { storeId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
    });
  }

  async secenekGrubuOlustur(storeId: string, userId: string, roles: Role[], dto: SecenekGrubuDto) {
    await this.market.assertOwner(storeId, userId, roles);
    const min = dto.minSecim ?? 0;
    const max = dto.maxSecim ?? 1;
    this.secimSiniriDogrula(min, max, dto.zorunlu ?? false);
    return this.prisma.optionGroup.create({
      data: {
        storeId,
        name: dto.name,
        minSecim: min,
        maxSecim: max,
        zorunlu: dto.zorunlu ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async secenekGrubuGuncelle(groupId: string, userId: string, roles: Role[], dto: SecenekGrubuDto) {
    const grup = await this.prisma.optionGroup.findUnique({ where: { id: groupId } });
    if (!grup) throw new NotFoundException('Secenek grubu bulunamadi');
    await this.market.assertOwner(grup.storeId, userId, roles);
    this.secimSiniriDogrula(
      dto.minSecim ?? grup.minSecim,
      dto.maxSecim ?? grup.maxSecim,
      dto.zorunlu ?? grup.zorunlu,
    );
    return this.prisma.optionGroup.update({
      where: { id: groupId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.minSecim !== undefined ? { minSecim: dto.minSecim } : {}),
        ...(dto.maxSecim !== undefined ? { maxSecim: dto.maxSecim } : {}),
        ...(dto.zorunlu !== undefined ? { zorunlu: dto.zorunlu } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  // SILME DEGIL KAPATMA: grup silinirse ona bagli urun eslesmeleri Cascade ile
  // gider ve gecmis menu yapisi kaybolur.
  async secenekGrubuSil(groupId: string, userId: string, roles: Role[]) {
    const grup = await this.prisma.optionGroup.findUnique({ where: { id: groupId } });
    if (!grup) throw new NotFoundException('Secenek grubu bulunamadi');
    await this.market.assertOwner(grup.storeId, userId, roles);
    await this.prisma.optionGroup.update({ where: { id: groupId }, data: { isActive: false } });
    return { deactivated: true };
  }

  async secenekEkle(groupId: string, userId: string, roles: Role[], dto: SecenekDto) {
    const grup = await this.prisma.optionGroup.findUnique({ where: { id: groupId } });
    if (!grup) throw new NotFoundException('Secenek grubu bulunamadi');
    await this.market.assertOwner(grup.storeId, userId, roles);
    return this.prisma.option.create({
      data: {
        optionGroupId: groupId,
        name: dto.name,
        ekUcret: BigInt(dto.ekUcret ?? 0),
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async secenekGuncelle(optionId: string, userId: string, roles: Role[], dto: SecenekDto) {
    const secenek = await this.prisma.option.findUnique({
      where: { id: optionId },
      include: { group: { select: { storeId: true } } },
    });
    if (!secenek) throw new NotFoundException('Secenek bulunamadi');
    await this.market.assertOwner(secenek.group.storeId, userId, roles);
    return this.prisma.option.update({
      where: { id: optionId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.ekUcret !== undefined ? { ekUcret: BigInt(dto.ekUcret) } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async secenekSil(optionId: string, userId: string, roles: Role[]) {
    const secenek = await this.prisma.option.findUnique({
      where: { id: optionId },
      include: { group: { select: { storeId: true } } },
    });
    if (!secenek) throw new NotFoundException('Secenek bulunamadi');
    await this.market.assertOwner(secenek.group.storeId, userId, roles);
    await this.prisma.option.update({ where: { id: optionId }, data: { isActive: false } });
    return { deactivated: true };
  }

  // Urun <-> grup eslesmesi TOPLU yazilir: gonderilen liste NIHAI durumdur.
  // Kismi guncellemede istemcinin iki cagri arasinda tutarsiz durum birakma
  // ihtimali boylece ortadan kalkar.
  async urunSecenekGruplari(productId: string, userId: string, roles: Role[], dto: UrunSecenekGruplariDto) {
    const urun = await this.urunVeMagaza(productId, userId, roles);
    const idler = dto.optionGroupIds ?? [];
    if (idler.length > 0) {
      // Gruplar AYNI MAGAZAYA ait olmali: baska magazanin menu grubu bu urune
      // baglanamaz.
      const sayi = await this.prisma.optionGroup.count({
        where: { id: { in: idler }, storeId: urun.storeId },
      });
      if (sayi !== idler.length) {
        throw new BadRequestException('Secenek gruplarindan bazilari bu magazaya ait degil');
      }
    }
    await this.prisma.$transaction([
      this.prisma.productOptionGroup.deleteMany({ where: { productId } }),
      this.prisma.productOptionGroup.createMany({
        data: idler.map((optionGroupId, i) => ({ productId, optionGroupId, sortOrder: i })),
      }),
    ]);
    return this.prisma.productOptionGroup.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
      include: { group: { include: { options: true } } },
    });
  }

  // ---------------- MEDYA ----------------

  async medyaListesi(productId: string, userId: string, roles: Role[]) {
    await this.urunVeMagaza(productId, userId, roles);
    return this.prisma.productMedia.findMany({ where: { productId }, orderBy: { sortOrder: 'asc' } });
  }

  async medyaEkle(productId: string, userId: string, roles: Role[], dto: MedyaEkleDto) {
    await this.urunVeMagaza(productId, userId, roles);
    const medya = await this.prisma.productMedia.create({
      data: {
        productId,
        url: dto.url,
        tur: dto.tur ?? 'GORSEL',
        sortOrder: dto.sortOrder ?? 0,
        isPrimary: dto.isPrimary ?? false,
      },
    });
    if (medya.isPrimary) await this.birincilMedyayiUygula(productId, medya.id, medya.url);
    return medya;
  }

  async medyaGuncelle(mediaId: string, userId: string, roles: Role[], dto: MedyaGuncelleDto) {
    const mevcut = await this.prisma.productMedia.findUnique({
      where: { id: mediaId },
      include: { product: { select: { storeId: true } } },
    });
    if (!mevcut) throw new NotFoundException('Medya bulunamadi');
    await this.market.assertOwner(mevcut.product.storeId, userId, roles);
    const medya = await this.prisma.productMedia.update({
      where: { id: mediaId },
      data: {
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isPrimary !== undefined ? { isPrimary: dto.isPrimary } : {}),
      },
    });
    if (medya.isPrimary) await this.birincilMedyayiUygula(medya.productId, medya.id, medya.url);
    return medya;
  }

  async medyaSil(mediaId: string, userId: string, roles: Role[]) {
    const medya = await this.prisma.productMedia.findUnique({
      where: { id: mediaId },
      include: { product: { select: { storeId: true } } },
    });
    if (!medya) throw new NotFoundException('Medya bulunamadi');
    await this.market.assertOwner(medya.product.storeId, userId, roles);
    await this.prisma.productMedia.delete({ where: { id: mediaId } });
    return { deleted: true };
  }

  /**
   * BIRINCIL MEDYA TEKTIR: yeni birincil isaretlenince digerleri dusurulur ve
   * Product.imageUrl (kapak gorseli; tum vitrin okumalarinin baktigi alan) ayni
   * degere cekilir. Iki kaynak arasindaki tutarsizlik YAZMA ANINDA kapatilir;
   * tek kaynaga indirme (imageUrl'i tamamen medyadan turetme) F4'e birakildi.
   */
  private async birincilMedyayiUygula(productId: string, mediaId: string, url: string) {
    await this.prisma.productMedia.updateMany({
      where: { productId, id: { not: mediaId } },
      data: { isPrimary: false },
    });
    await this.prisma.product.update({ where: { id: productId }, data: { imageUrl: url } });
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
