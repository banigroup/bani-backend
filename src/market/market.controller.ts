import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '../common/decorators/public.decorator';
import { cloudinaryUpload } from '../common/upload/cloudinary.util';
import type { Request } from 'express';
import { MarketService } from './market.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { PersonelEkleDto, PersonelDurumDto } from './dto/store-user.dto';
import { RolAtaDto } from './dto/rol-ata.dto';
import { SaticiGuncelleDto, SaticiDurumDto, SaticiDogrulamaDto, BelgeReddetDto } from './dto/seller.dto';
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

  // B1 — admin inceleme kuyrugu. Varsayilan UNDER_REVIEW.
  // Asagidaki iki uc sellerId ISTIYOR ama admin o id'yi hicbir yerden
  // ogrenemiyordu; bu uc o boslugu kapatir. Yetki asagidakilerle AYNI:
  // STORE_MANAGE_ALL + serviste platform yoneticisi kontrolu.
  // Salt okuma oldugu icin audit YOK (mevcut GET uclariyla ayni).
  @Get('sellers')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_MANAGE_ALL)
  saticiListesi(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.market.saticiListele(user.roles, status, Number(skip) || 0, Number(take) || 50);
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

  // ---------------- SATICI KYC BELGELERI ----------------
  // load.controller'daki belge uclarinin satici karsiligi. Fark: orada kilit
  // @Roles(CARRIER, LOAD_CUSTOMER), burada mevcut market deseni (izin tabanli).

  // Dosya RAM'e alinir (dosya.buffer). Limitler load.controller'daki belge
  // ucuyla BIREBIR AYNI ve ayni gerekceyle: multer 2.0.2 DoS advisory'leri
  // (GHSA-v52c/5528/72gw) tam bu yuzeyi hedefliyor. 10 MB vergi levhasi
  // foto/PDF'i icin fazlasiyla yeterli; parts = 1 dosya + 'tip' alani + pay.
  @Post('seller/belge')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  @UseInterceptors(
    FileInterceptor('dosya', {
      limits: { fileSize: 10 * 1024 * 1024, fields: 10, parts: 12 },
    }),
  )
  async belgeYukle(
    @CurrentUser() user: AuthUser,
    @UploadedFile() dosya: any,
    @Body('tip') tip: string,
    @Req() req: Request,
  ) {
    if (!dosya) throw new BadRequestException('Dosya gerekli');
    const url = await cloudinaryUpload(dosya.buffer, `banimarket/satici/${user.id}`);
    const r = await this.market.belgeEkle(user.id, tip, url);
    // metadata'ya dosya URL'i YAZILMAZ; yalnizca hangi tip belge yuklendigi.
    await this.audit.record({ actorId: user.id, action: 'seller.belge.yukle', entity: 'SaticiBelge', entityId: r.id, ip: req.ip, metadata: { tip } });
    return r;
  }

  @Get('seller/belgeler')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_READ)
  belgelerim(@CurrentUser() user: AuthUser) {
    return this.market.belgelerim(user.id);
  }

  @Get('sellers/belgeler/bekleyenler')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_MANAGE_ALL)
  bekleyenBelgeler(@CurrentUser() user: AuthUser, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.market.bekleyenBelgeler(user.roles, Number(skip) || 0, Number(take) || 50);
  }

  @Patch('sellers/belgeler/:id/onayla')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_MANAGE_ALL)
  async belgeOnayla(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const r = await this.market.belgeOnayla(user.roles, id);
    await this.audit.record({ actorId: user.id, action: 'seller.belge.onay', entity: 'SaticiBelge', entityId: id, ip: req.ip, metadata: { verification: r.satici.verification } });
    return r;
  }

  @Patch('sellers/belgeler/:id/reddet')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_MANAGE_ALL)
  async belgeReddet(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: BelgeReddetDto, @Req() req: Request) {
    const r = await this.market.belgeReddet(user.roles, id, dto.gerekce);
    await this.audit.record({ actorId: user.id, action: 'seller.belge.red', entity: 'SaticiBelge', entityId: id, ip: req.ip, metadata: { gerekce: dto.gerekce ?? null, verification: r.satici.verification } });
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
