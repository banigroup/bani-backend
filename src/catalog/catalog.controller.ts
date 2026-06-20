import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { RequirePermissions } from '../common/rbac/permissions.decorator';
import { Permission } from '../common/rbac/permissions.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // Herkese acik okuma
  @Get('stores/:storeId/categories')
  categories(@Param('storeId') storeId: string) {
    return this.catalog.listCategories(storeId);
  }

  @Get('stores/:storeId/products')
  products(
    @Param('storeId') storeId: string,
    @Query('categoryId') categoryId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.catalog.listProducts(storeId, categoryId, Number(skip) || 0, Number(take) || 50);
  }

  @Get('products/:id')
  product(@Param('id') id: string) {
    return this.catalog.getProduct(id);
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
  @Patch('products/:id/approve')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.approveProduct(id, user.id, user.roles);
  }

  @Patch('products/:id/reject')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.rejectProduct(id, user.id, user.roles);
  }

  @Delete('products/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.PRODUCT_WRITE)
  removeProduct(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.catalog.removeProduct(id, user.id, user.roles);
  }
}
