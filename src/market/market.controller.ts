import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import type { Request } from 'express';
import { MarketService } from './market.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { PersonelEkleDto, PersonelDurumDto } from './dto/store-user.dto';
import { RolAtaDto } from './dto/rol-ata.dto';
import { SaticiGuncelleDto, SaticiDurumDto, SaticiDogrulamaDto } from './dto/seller.dto';
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

  // ---------------- SATICI (SELLER) ----------------

  @Get('seller')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_READ)
  saticim(@CurrentUser() user: AuthUser) {
    return this.market.saticim(user.id);
  }

  @Patch('seller')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  async saticiGuncelle(@CurrentUser() user: AuthUser, @Body() dto: SaticiGuncelleDto, @Req() req: Request) {
    const r = await this.market.saticiGuncelle(user.id, dto);
    // metadata'ya vergi kimligi YAZILMAZ; yalnizca hangi alanlarin degistigi.
    await this.audit.record({ actorId: user.id, action: 'seller.update', entity: 'Seller', entityId: r.id, ip: req.ip, metadata: { alanlar: Object.keys(dto) } });
    return r;
  }

  @Post('seller/submit')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  async saticiOnayaGonder(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const r = await this.market.saticiOnayaGonder(user.id);
    await this.audit.record({ actorId: user.id, action: 'seller.submit', entity: 'Seller', entityId: r.id, ip: req.ip });
    return r;
  }

  @Patch('sellers/:id/status')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_MANAGE_ALL)
  async saticiDurum(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SaticiDurumDto, @Req() req: Request) {
    const r = await this.market.saticiDurumDegistir(user.roles, id, dto.status);
    await this.audit.record({ actorId: user.id, action: 'seller.status', entity: 'Seller', entityId: id, ip: req.ip, metadata: { to: dto.status } });
    return r;
  }

  @Patch('sellers/:id/verification')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_MANAGE_ALL)
  async saticiDogrulama(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SaticiDogrulamaDto, @Req() req: Request) {
    const r = await this.market.saticiDogrulama(user.roles, id, dto.sonuc, dto.verificationExpiresAt ? new Date(dto.verificationExpiresAt) : undefined);
    await this.audit.record({ actorId: user.id, action: 'seller.verification', entity: 'Seller', entityId: id, ip: req.ip, metadata: { sonuc: dto.sonuc } });
    return r;
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
    // C4: metadata'ya kapsam ve rol eklendi — "kime, HANGI MAGAZADA, HANGI ROL
    // verildi" sorusu audit'ten cevaplanabilmeli.
    await this.audit.record({ actorId: user.id, action: 'store.user.add', entity: 'Store', entityId: id, ip: req.ip, metadata: { userId: dto.userId, storeId: id, role: 'STORE_STAFF' } });
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
    // C4: pasiflestirme o magazanin ROL SATIRLARINI da siliyor; kayit bunu
    // yansitsin diye storeId ve etkilenen rol metadata'ya eklendi.
    await this.audit.record({ actorId: user.id, action: 'store.user.status', entity: 'Store', entityId: id, ip: req.ip, metadata: { userId, isActive: dto.isActive, storeId: id, role: 'STORE_STAFF' } });
    return r;
  }

  // ---- MAGAZA ROL ATAMA (Faz 1 / B2) ----
  // Ayni kapi: sahipVeyaYonetici (serviste). Karar 4 geregi STORE_STAFF bu
  // uclari cagiramaz - kapinin arkasinda olduklari icin kendiliginden oyle.
  // Atanabilir roller serviste KODDA SABIT listeyle sinirli; STORE_STAFF ve
  // platform rolleri (ADMIN/SUPER_ADMIN...) 400 ile reddedilir.

  @Post('stores/:id/users/:userId/roles')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  async rolVer(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: RolAtaDto,
    @Req() req: Request,
  ) {
    const r = await this.market.rolVer(id, user.id, user.roles, userId, dto.role);
    await this.audit.record({
      actorId: user.id, action: 'store.user.role.grant', entity: 'Store', entityId: id, ip: req.ip,
      metadata: { storeId: id, targetUserId: userId, role: dto.role, degisti: r.degisti },
    });
    return r;
  }

  @Delete('stores/:id/users/:userId/roles/:role')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  async rolAl(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Param('role') role: string,
    @Req() req: Request,
  ) {
    const r = await this.market.rolAl(id, user.id, user.roles, userId, role);
    await this.audit.record({
      actorId: user.id, action: 'store.user.role.revoke', entity: 'Store', entityId: id, ip: req.ip,
      metadata: { storeId: id, targetUserId: userId, role, degisti: r.degisti },
    });
    return r;
  }
}
