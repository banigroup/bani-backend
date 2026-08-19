import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import type { Request } from 'express';
import { MarketService } from './market.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { PersonelEkleDto, PersonelDurumDto } from './dto/store-user.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { RequirePermissions } from '../common/rbac/permissions.decorator';
import { Permission } from '../common/rbac/permissions.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../common/audit/audit.service';

@Controller('market')
export class MarketController {
  constructor(
    private readonly market: MarketService,
    private readonly audit: AuditService,
  ) {}

  // Herkese açık: aktif mağaza listesi
  @Public()
  @Get('stores')
  list(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.market.listActive(Number(skip) || 0, Number(take) || 50);
  }

  @Public()
  @Get('stores/slug/:slug')
  getBySlug(@Param('slug') slug: string) {
    return this.market.getBySlug(slug);
  }

  @Public()
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

  // ---------------- MAGAZA PERSONELI ----------------
  // Yetki bu uclarda DAHA DAR: magaza sahibi ya da platform yoneticisi
  // (market.service.sahipVeyaYonetici). Personelin personel eklemesi kapali.
  // Audit controller katmaninda (kural 7).

  @Get('stores/:id/users')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  personelListesi(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.market.personelListesi(id, user.id, user.roles);
  }

  @Post('stores/:id/users')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  async personelEkle(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: PersonelEkleDto, @Req() req: Request) {
    const r = await this.market.personelEkle(id, user.id, user.roles, dto.userId);
    await this.audit.record({ actorId: user.id, action: 'store.user.add', entity: 'Store', entityId: id, ip: req.ip, metadata: { userId: dto.userId } });
    return r;
  }

  @Patch('stores/:id/users/:userId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  async personelDurum(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: PersonelDurumDto,
    @Req() req: Request,
  ) {
    const r = await this.market.personelDurum(id, user.id, user.roles, userId, dto.isActive);
    await this.audit.record({ actorId: user.id, action: 'store.user.status', entity: 'Store', entityId: id, ip: req.ip, metadata: { userId, isActive: dto.isActive } });
    return r;
  }
}
