import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { MarketService } from './market.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { RequirePermissions } from '../common/rbac/permissions.decorator';
import { Permission } from '../common/rbac/permissions.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  // Herkese açık: aktif mağaza listesi
  @Get('stores')
  list(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.market.listActive(Number(skip) || 0, Number(take) || 50);
  }

  @Get('stores/slug/:slug')
  getBySlug(@Param('slug') slug: string) {
    return this.market.getBySlug(slug);
  }

  @Get('stores/:id')
  getById(@Param('id') id: string) {
    return this.market.getById(id);
  }

  // Satıcı: kendi mağazaları
  @Get('my/stores')
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() user: AuthUser) {
    return this.market.myStores(user.id);
  }

  @Post('stores')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStoreDto, @Req() req: Request) {
    return this.market.create(user.id, dto, req.ip);
  }

  @Patch('stores/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateStoreDto, @Req() req: Request) {
    return this.market.update(id, user.id, user.roles, dto, req.ip);
  }
}
