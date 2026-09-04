import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  VaryantOlusturDto, VaryantGuncelleDto, SecenekGrubuDto, SecenekDto,
  UrunSecenekGruplariDto, MedyaEkleDto, MedyaGuncelleDto,
} from './dto/varyant.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { RequirePermissions } from '../common/rbac/permissions.decorator';
import { Permission } from '../common/rbac/permissions.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { UuidParam, UuidQuery } from '../common/pipes/uuid-param.pipe';
import { AuditService } from '../common/audit/audit.service';

@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly audit: AuditService,
  ) {}

  // ============================================================
  // AUDIT — KRITIK OLAY KAYDI YALNIZCA BURADA (controller katmani).
  // Servise ikinci kayit EKLENMEZ: cift kayit yasagi. Desen
  // market.controller ile birebir ayni: { actorId, action, entity, entityId,
  // ip, metadata }.
  //
  // PARA ALANLARI metadata'ya STRING yazilir. price/netFiyat BigInt ve
  // metadata Prisma'nin Json kolonuna gidiyor; main.ts'teki
  // BigInt.prototype.toJSON yamasi JSON.stringify yolunu duzeltir, Prisma'nin
  // Json alan yazimini degil. String() ile gonderilmezse kayit sessizce
  // dusebilirdi (AuditService hatayi yutup logluyor).
  // ============================================================

  // Herkese acik okuma
  @Public()
  @Get('stores/:storeId/categories')
  categories(@Param('storeId', UuidParam) storeId: string, @Query('tumu') tumu?: string) {
    // tumu=1 -> yonetim ekrani: bos kategoriler de doner
    return this.catalog.listCategories(storeId, tumu === '1');
  }

  @Public()
  @Get('stores/:storeId/products')
  products(
    @Param('storeId', UuidParam) storeId: string,
    // categoryId dogrudan Category.id / Category.parentId (@db.Uuid) kosuluna
    // giriyor (catalog.service.listProducts). Bu uc @Public - dogrulanmadigi
    // surece gecersiz bir deger KIMLIKSIZ trafikle 500 uretebiliyordu.
    @Query('categoryId', UuidQuery) categoryId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.catalog.listProducts(storeId, categoryId, Number(skip) || 0, Number(take) || 50);
  }

  // MUSTERI DETAYI: muhasebe kirilimi (netFiyat/komisyon/kargo/KDV) DONMEZ,
  // yalnizca vitrin fiyati. Kirilimi goren tekil-urun ucu asagidaki :id/detay.
  @Public()
  @Get('products/:id')
  product(@Param('id', UuidParam) id: string) {
    return this.catalog.getPublicProduct(id);
  }

  // SATICI DETAYI: tam satir (muhasebe kirilimi dahil). Duzenleme ekraninin
  // formu net fiyati buradan doldurur.
  @Get('products/:id/detay')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  urunDetay(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.urunDetay(id, user.id, user.roles);
  }

  // Onay bekleyen urunler (magaza sahibi / admin)
  @Get('stores/:storeId/pending')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  pending(@Param('storeId', UuidParam) storeId: string, @CurrentUser() user: AuthUser) {
    return this.catalog.listPending(storeId, user.id, user.roles);
  }

  // Satici islemleri
  @Post('stores/:storeId/categories')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.CATEGORY_WRITE)
  createCategory(@Param('storeId', UuidParam) storeId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(storeId, user.id, user.roles, dto);
  }

  // GORSEL YUKLEME IMZASI — MAGAZA KAPSAMLI.
  //
  // ISTEMCIDEN HICBIR PARAMETRE ALINMAZ: @Body YOK. Klasor, timestamp ve imza
  // tamamen sunucuda uretilir. Istemci govdede folder/upload_preset gonderse
  // bile okunmaz - imzalanan deger sunucununkidir, farkli bir klasorle yapilan
  // yukleme Cloudinary tarafinda imza uyusmazligindan reddedilir.
  //
  // URUN DEGIL MAGAZA KAPSAMI: gorsel, urun HENUZ YOKKEN de yuklenebilmeli
  // (once gorseli sec, sonra urunu olustur akisi). Yetki kapisi bu yuzden
  // urun degil magaza uzerinden: market.assertOwner (sahip | aktif personel |
  // platform yoneticisi) - urun yazma uclarinin dayandigi kapinin aynisi.
  @Post('stores/:storeId/media-imza')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  async medyaImza(@Param('storeId', UuidParam) storeId: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const r = await this.catalog.medyaYuklemeImzasi(storeId, user.id, user.roles);
    // AUDIT: imza bir YUKLEME YETKISIDIR, verilmesi kayda gecer (PR #16 deseni).
    // metadata'ya YALNIZCA klasor yazilir; signature/apiKey audit'e GIRMEZ -
    // KYC ucunda dosya URL'inin yazilmamasiyla ayni gerekce.
    await this.audit.record({
      actorId: user.id, action: 'product.media.sign', entity: 'Store', entityId: storeId, ip: req.ip,
      metadata: { folder: r.folder },
    });
    return r;
  }

  @Post('stores/:storeId/products')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  async createProduct(
    @Param('storeId', UuidParam) storeId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProductDto,
    @Req() req: Request,
  ) {
    const r = await this.catalog.createProduct(storeId, user.id, user.roles, dto);
    await this.audit.record({
      actorId: user.id, action: 'product.create', entity: 'Product', entityId: r.id, ip: req.ip,
      metadata: {
        storeId, ad: r.name, alanlar: Object.keys(dto),
        price: String(r.price), netFiyat: String(r.netFiyat), stock: r.stock, isActive: r.isActive,
      },
    });
    return r;
  }

  @Patch('products/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  async updateProduct(
    @Param('id', UuidParam) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProductDto,
    @Req() req: Request,
  ) {
    // ONCEKI HAL AYRI SORGUYLA OKUNUR. Servis yalnizca guncel satiri
    // donduruyor; "hangi fiyattan hangi fiyata" sorusu ancak once/sonra
    // ikilisiyle cevaplanir ve fiyat degisikligi bu ucun en hassas etkisi.
    // getProduct, servisin updateProduct icinde zaten yaptigi ilk cagrinin
    // aynisi ve yetki kontrolu ondan SONRA geliyor: yetkisiz kullanici
    // eskisiyle ayni 404/403'u alir, yeni bir sizinti yok.
    const once = await this.catalog.getProduct(id);
    const r = await this.catalog.updateProduct(id, user.id, user.roles, dto);
    await this.audit.record({
      actorId: user.id, action: 'product.update', entity: 'Product', entityId: id, ip: req.ip,
      metadata: {
        storeId: r.storeId, ad: r.name, alanlar: Object.keys(dto),
        once: {
          price: String(once.price), netFiyat: String(once.netFiyat),
          stock: once.stock, isActive: once.isActive,
        },
        sonra: {
          price: String(r.price), netFiyat: String(r.netFiyat),
          stock: r.stock, isActive: r.isActive,
        },
        // YENIDEN ONAY KAPISI TETIKLENDI MI (catalog.service updateProduct).
        // "Urunum neden vitrinden dustu" sorusunun tek izlenebilir cevabi.
        yenidenOnaya: once.isActive && !r.isActive,
      },
    });
    return r;
  }

  // Admin: onayla / reddet
  // PRODUCT_WRITE degil PRODUCT_APPROVE: birincisi saticida da var, yani onay
  // ucuna satici da girebiliyordu (iceride reddediliyordu ama kapi aciktI).
  // PRODUCT_APPROVE yalnizca ADMIN + SUPER_ADMIN'de; bu izin bugune kadar
  // hicbir ucta kullanilmadigi icin oludur, yeri burasidir.
  @Patch('products/:id/approve')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_APPROVE)
  async approve(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const r = await this.catalog.approveProduct(id, user.id, user.roles);
    await this.audit.record({
      actorId: user.id, action: 'product.approve', entity: 'Product', entityId: id, ip: req.ip,
      metadata: { storeId: r.storeId, ad: r.name, price: String(r.price), isActive: r.isActive },
    });
    return r;
  }

  @Patch('products/:id/reject')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_APPROVE)
  async reject(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    // ANLIK GORUNTU ONCEDEN ALINIR: reject deletedAt yaziyor ve hicbir okuma
    // ucu deletedAt dolu satir dondurmuyor. Kayit sonradan kurulsaydi audit
    // satiri "neyin reddedildigini" soyleyemezdi.
    const once = await this.catalog.getProduct(id);
    const r = await this.catalog.rejectProduct(id, user.id, user.roles);
    await this.audit.record({
      actorId: user.id, action: 'product.reject', entity: 'Product', entityId: id, ip: req.ip,
      metadata: {
        storeId: once.storeId, ad: once.name, price: String(once.price),
        onceAktifMiydi: once.isActive,
      },
    });
    return r;
  }

  @Delete('products/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  async removeProduct(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    // reject ile ayni gerekce: silinen satir sonradan okunamaz.
    const once = await this.catalog.getProduct(id);
    const r = await this.catalog.removeProduct(id, user.id, user.roles);
    await this.audit.record({
      actorId: user.id, action: 'product.delete', entity: 'Product', entityId: id, ip: req.ip,
      metadata: {
        storeId: once.storeId, ad: once.name, price: String(once.price),
        onceAktifMiydi: once.isActive,
      },
    });
    return r;
  }

  // ============================================================
  // FAZ 3 / ADIM 2.5 — KATALOG YAZMA UCLARI
  // Hepsi PRODUCT_WRITE ister; veri kapsami servis icinde
  // market.assertOwner ile daraltilir (sahip | personel | platform yoneticisi).
  // ============================================================

  // ---- Varyant ----
  @Get('products/:id/variants')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  varyantListesi(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.varyantListesi(id, user.id, user.roles);
  }

  @Post('products/:id/variants')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  varyantOlustur(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser, @Body() dto: VaryantOlusturDto) {
    return this.catalog.varyantOlustur(id, user.id, user.roles, dto);
  }

  @Patch('variants/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  varyantGuncelle(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser, @Body() dto: VaryantGuncelleDto) {
    return this.catalog.varyantGuncelle(id, user.id, user.roles, dto);
  }

  @Delete('variants/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  varyantSil(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.varyantSil(id, user.id, user.roles);
  }

  // ---- Secenek grubu ve secenekler ----
  @Get('stores/:storeId/option-groups')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  secenekGruplari(@Param('storeId', UuidParam) storeId: string, @CurrentUser() user: AuthUser) {
    return this.catalog.secenekGruplari(storeId, user.id, user.roles);
  }

  @Post('stores/:storeId/option-groups')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  secenekGrubuOlustur(@Param('storeId', UuidParam) storeId: string, @CurrentUser() user: AuthUser, @Body() dto: SecenekGrubuDto) {
    return this.catalog.secenekGrubuOlustur(storeId, user.id, user.roles, dto);
  }

  @Patch('option-groups/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  secenekGrubuGuncelle(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser, @Body() dto: SecenekGrubuDto) {
    return this.catalog.secenekGrubuGuncelle(id, user.id, user.roles, dto);
  }

  @Delete('option-groups/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  secenekGrubuSil(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.secenekGrubuSil(id, user.id, user.roles);
  }

  @Post('option-groups/:id/options')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  secenekEkle(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser, @Body() dto: SecenekDto) {
    return this.catalog.secenekEkle(id, user.id, user.roles, dto);
  }

  @Patch('options/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  secenekGuncelle(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser, @Body() dto: SecenekDto) {
    return this.catalog.secenekGuncelle(id, user.id, user.roles, dto);
  }

  @Delete('options/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  secenekSil(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.secenekSil(id, user.id, user.roles);
  }

  // Urun <-> grup eslesmesi TOPLU yazilir (gonderilen liste nihai durumdur).
  @Put('products/:id/option-groups')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  urunSecenekGruplari(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser, @Body() dto: UrunSecenekGruplariDto) {
    return this.catalog.urunSecenekGruplari(id, user.id, user.roles, dto);
  }

  // ---- Medya ----
  @Get('products/:id/media')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  medyaListesi(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.medyaListesi(id, user.id, user.roles);
  }

  @Post('products/:id/media')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  medyaEkle(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser, @Body() dto: MedyaEkleDto) {
    return this.catalog.medyaEkle(id, user.id, user.roles, dto);
  }

  @Patch('media/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  medyaGuncelle(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser, @Body() dto: MedyaGuncelleDto) {
    return this.catalog.medyaGuncelle(id, user.id, user.roles, dto);
  }

  @Delete('media/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  medyaSil(@Param('id', UuidParam) id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.medyaSil(id, user.id, user.roles);
  }
}
