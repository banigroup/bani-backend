import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
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

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // Herkese acik okuma
  @Public()
  @Get('stores/:storeId/categories')
  categories(@Param('storeId') storeId: string, @Query('tumu') tumu?: string) {
    // tumu=1 -> yonetim ekrani: bos kategoriler de doner
    return this.catalog.listCategories(storeId, tumu === '1');
  }

  @Public()
  @Get('stores/:storeId/products')
  products(
    @Param('storeId') storeId: string,
    @Query('categoryId') categoryId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.catalog.listProducts(storeId, categoryId, Number(skip) || 0, Number(take) || 50);
  }

  @Public()
  @Get('products/:id')
  product(@Param('id') id: string) {
    return this.catalog.getPublicProduct(id);
  }

  // Onay bekleyen urunler (magaza sahibi / admin)
  @Get('stores/:storeId/pending')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  pending(@Param('storeId') storeId: string, @CurrentUser() user: AuthUser) {
    return this.catalog.listPending(storeId, user.id, user.roles);
  }

  // Satici islemleri
  @Post('stores/:storeId/categories')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.CATEGORY_WRITE)
  createCategory(@Param('storeId') storeId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(storeId, user.id, user.roles, dto);
  }

  @Post('stores/:storeId/products')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  createProduct(@Param('storeId') storeId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    return this.catalog.createProduct(storeId, user.id, user.roles, dto);
  }

  @Patch('products/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  updateProduct(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UpdateProductDto) {
    return this.catalog.updateProduct(id, user.id, user.roles, dto);
  }

  // Admin: onayla / reddet
  // PRODUCT_WRITE degil PRODUCT_APPROVE: birincisi saticida da var, yani onay
  // ucuna satici da girebiliyordu (iceride reddediliyordu ama kapi aciktI).
  // PRODUCT_APPROVE yalnizca ADMIN + SUPER_ADMIN'de; bu izin bugune kadar
  // hicbir ucta kullanilmadigi icin oludur, yeri burasidir.
  @Patch('products/:id/approve')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_APPROVE)
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.approveProduct(id, user.id, user.roles);
  }

  @Patch('products/:id/reject')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_APPROVE)
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.rejectProduct(id, user.id, user.roles);
  }

  @Delete('products/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  removeProduct(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.removeProduct(id, user.id, user.roles);
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
  varyantListesi(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.varyantListesi(id, user.id, user.roles);
  }

  @Post('products/:id/variants')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  varyantOlustur(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: VaryantOlusturDto) {
    return this.catalog.varyantOlustur(id, user.id, user.roles, dto);
  }

  @Patch('variants/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  varyantGuncelle(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: VaryantGuncelleDto) {
    return this.catalog.varyantGuncelle(id, user.id, user.roles, dto);
  }

  @Delete('variants/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  varyantSil(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.varyantSil(id, user.id, user.roles);
  }

  // ---- Secenek grubu ve secenekler ----
  @Get('stores/:storeId/option-groups')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  secenekGruplari(@Param('storeId') storeId: string, @CurrentUser() user: AuthUser) {
    return this.catalog.secenekGruplari(storeId, user.id, user.roles);
  }

  @Post('stores/:storeId/option-groups')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  secenekGrubuOlustur(@Param('storeId') storeId: string, @CurrentUser() user: AuthUser, @Body() dto: SecenekGrubuDto) {
    return this.catalog.secenekGrubuOlustur(storeId, user.id, user.roles, dto);
  }

  @Patch('option-groups/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  secenekGrubuGuncelle(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: SecenekGrubuDto) {
    return this.catalog.secenekGrubuGuncelle(id, user.id, user.roles, dto);
  }

  @Delete('option-groups/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  secenekGrubuSil(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.secenekGrubuSil(id, user.id, user.roles);
  }

  @Post('option-groups/:id/options')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  secenekEkle(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: SecenekDto) {
    return this.catalog.secenekEkle(id, user.id, user.roles, dto);
  }

  @Patch('options/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  secenekGuncelle(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: SecenekDto) {
    return this.catalog.secenekGuncelle(id, user.id, user.roles, dto);
  }

  @Delete('options/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  secenekSil(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.secenekSil(id, user.id, user.roles);
  }

  // Urun <-> grup eslesmesi TOPLU yazilir (gonderilen liste nihai durumdur).
  @Put('products/:id/option-groups')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  urunSecenekGruplari(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: UrunSecenekGruplariDto) {
    return this.catalog.urunSecenekGruplari(id, user.id, user.roles, dto);
  }

  // ---- Medya ----
  @Get('products/:id/media')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  medyaListesi(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.medyaListesi(id, user.id, user.roles);
  }

  @Post('products/:id/media')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  medyaEkle(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: MedyaEkleDto) {
    return this.catalog.medyaEkle(id, user.id, user.roles, dto);
  }

  @Patch('media/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  medyaGuncelle(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: MedyaGuncelleDto) {
    return this.catalog.medyaGuncelle(id, user.id, user.roles, dto);
  }

  @Delete('media/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  medyaSil(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.medyaSil(id, user.id, user.roles);
  }
}
