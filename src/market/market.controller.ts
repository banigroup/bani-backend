import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req,
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
import { SaticiSozlesmeOnaylaDto } from './dto/sozlesme.dto';
import { CalismaSaatleriDto } from './dto/calisma-saati.dto';
import { SaticiSiparisSorguDto } from './dto/seller-orders.dto';
import type { SozlesmeTipi } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { RequirePermissions } from '../common/rbac/permissions.decorator';
import { Permission } from '../common/rbac/permissions.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { UuidParam } from '../common/pipes/uuid-param.pipe';
import { AuditService } from '../common/audit/audit.service';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { OnbellekService } from '../common/cache/onbellek.service';

@Controller('market')
export class MarketController {
  constructor(
    private readonly market: MarketService,
    private readonly audit: AuditService,
    private readonly onbellek: OnbellekService,
  ) {}

  // Herkese açık: aktif mağaza listesi
  //
  // ONBELLEKLI (60 sn) — vitrinin ana listesi, nadiren degisir.
  // KULLANICIYA OZEL DEGIL: listActive yalnizca "isActive + satici ACTIVE"
  // suzuyor, istekten hicbir sey okumuyor. TTL urun listesinden UZUN cunku
  // icerigi stok/fiyat gibi hizli degisen alan tasimiyor. Magaza yazmalari ve
  // satici durumu degisimi bu anahtarlari ANINDA temizler.
  //
  // DEKORATOR SIRASI: @Public @Get'in HEMEN USTUNDE kalmali -
  // scripts/check-guards.js korumayi bu yakinliktan okuyor (araya dekorator
  // girince uc "korumasiz" sayildi, yerelde yakalandi).
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(60_000)
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
  getById(@Param('id', UuidParam) id: string) {
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
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateStoreDto, @Req() req: Request) {
    const r = await this.market.create(user.id, dto, req.ip);
    // ONBELLEK: yeni magaza vitrin listesinde gorunmeli.
    await this.onbellek.magazaListesiniTemizle();
    return r;
  }

  @Patch('stores/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  async update(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body() dto: UpdateStoreDto, @Req() req: Request) {
    const r = await this.market.update(id, user.id, user.roles, dto, req.ip);
    // ONBELLEK: ad/logo/isActive degismis olabilir - liste bayatladi.
    await this.onbellek.magazaListesiniTemizle();
    return r;
  }

  // LOGO YUKLEME IMZASI — dosya sunucudan GECMEZ, istemci dogrudan
  // Cloudinary'ye yukler. Katalogdaki media-imza ucunun ikizi; farklar:
  // klasor bani/stores/<storeId> ve izin STORE_WRITE (logo magaza ayaridir).
  //
  // ISTEMCIDEN PARAMETRE ALINMAZ: @Body YOK. Govdede folder/upload_preset
  // gonderilse bile okunmaz; imzalanan deger sunucununkidir.
  @Post('stores/:id/logo-imza')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  async logoImza(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Req() req: Request) {
    const r = await this.market.logoImzasi(id, user.id, user.roles);
    // AUDIT: imza bir YUKLEME YETKISIDIR (katalog ucuyla ayni gerekce).
    // metadata'ya YALNIZCA klasor; signature/apiKey audit'e GIRMEZ.
    await this.audit.record({
      actorId: user.id, action: 'store.logo.sign', entity: 'Store', entityId: id, ip: req.ip,
      metadata: { folder: r.folder },
    });
    return r;
  }

  // ---------------- CALISMA SAATLERI ----------------
  //
  // Yetki magaza guncellemeyle AYNI: STORE_WRITE + serviste ownedOrAdmin.
  // Audit servis icinde yaziliyor - store.update ile ayni yerde durmasi icin
  // (bkz. o metodun basligi; market modulunde magaza yazmalarinin audit'i
  // serviste toplaniyor).

  @Get('stores/:id/calisma-saatleri')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_READ)
  calismaSaatleri(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.market.calismaSaatleri(id, user.id, user.roles);
  }

  @Put('stores/:id/calisma-saatleri')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  calismaSaatleriGuncelle(
    @CurrentUser() user: AuthUser,
    @Param('id', UuidParam) id: string,
    @Body() dto: CalismaSaatleriDto,
    @Req() req: Request,
  ) {
    return this.market.calismaSaatleriGuncelle(id, user.id, user.roles, dto, req.ip);
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
  async saticiDurum(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body() dto: SaticiDurumDto, @Req() req: Request) {
    const r = await this.market.saticiDurumDegistir(user.roles, id, dto.status);
    await this.audit.record({ actorId: user.id, action: 'seller.status', entity: 'Seller', entityId: id, ip: req.ip, metadata: { to: dto.status } });
    // ONBELLEK: satici durumu HEM magaza listesini HEM urun listelerini suzuyor
    // (listActive ve listProducts ikisi de "satici ACTIVE" kosulu tasiyor).
    // Askiya alinan satici vitrinden ANINDA dusmeli - TTL beklemek kabul
    // edilemez, bu bir yaptirim karari.
    await this.onbellek.magazaListesiniTemizle();
    await this.onbellek.tumUrunListeleriniTemizle();
    return r;
  }

  @Patch('sellers/:id/verification')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_MANAGE_ALL)
  async saticiDogrulama(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body() dto: SaticiDogrulamaDto, @Req() req: Request) {
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

  // ---------------- SATICI SIPARIS OZETI ----------------
  // Saticinin TUM magazalarindaki siparisler tek cagrida + sunucu tarafi
  // toplamlar. /orders/store/:storeId ucuna DOKUNULMADI; o magaza basina
  // calismaya devam ediyor (gerekce: MarketService.saticiSiparisleri basligi).
  //
  // Yetki ORDER_MANAGE: bu bir SIPARIS okumasi, magaza okumasi degil. Ayni
  // izin OrdersController.storeOrders'ta da kullaniliyor - desen korundu.
  // Salt okuma oldugu icin audit YOK (mevcut GET uclariyla ayni).
  @Get('seller/orders')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ORDER_MANAGE)
  saticiSiparisleri(@CurrentUser() user: AuthUser, @Query() q: SaticiSiparisSorguDto) {
    return this.market.saticiSiparisleri(user.id, q);
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
  async belgeOnayla(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Req() req: Request) {
    const r = await this.market.belgeOnayla(user.roles, id);
    await this.audit.record({ actorId: user.id, action: 'seller.belge.onay', entity: 'SaticiBelge', entityId: id, ip: req.ip, metadata: { verification: r.satici.verification } });
    return r;
  }

  @Patch('sellers/belgeler/:id/reddet')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_MANAGE_ALL)
  async belgeReddet(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body() dto: BelgeReddetDto, @Req() req: Request) {
    const r = await this.market.belgeReddet(user.roles, id, dto.gerekce);
    await this.audit.record({ actorId: user.id, action: 'seller.belge.red', entity: 'SaticiBelge', entityId: id, ip: req.ip, metadata: { gerekce: dto.gerekce ?? null, verification: r.satici.verification } });
    return r;
  }

  // ---------------- SATICI SOZLESMELERI ----------------
  // Cekirdek SozlesmeService zaten geneldi; eksik olan ERISIMDI. Mevcut uclar
  // LoadController icinde ve o sinif @Roles(CARRIER, LOAD_CUSTOMER) ile kilitli.
  // O kilide DOKUNULMADI - satici icin burada kendi uclari aciliyor.
  // Onaylanabilir tipler serviste beyaz listeyle sinirli (SATICI_SOZLESMELERI).

  // :tip'e UuidParam BILEREK TAKILMADI — SozlesmeTipi enum degeri, UUID degil.
  // a5ce23c'nin :role icin verdigi gerekcenin aynisi; dogrulama serviste
  // (SATICI_SOZLESMELERI beyaz listesi: liste disi -> 400).
  @Get('seller/sozlesme/:tip')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_READ)
  saticiSozlesmeDurum(@CurrentUser() user: AuthUser, @Param('tip') tip: SozlesmeTipi) {
    return this.market.saticiSozlesmeDurumu(user.id, tip);
  }

  @Post('seller/sozlesme/onayla')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  async saticiSozlesmeOnayla(@CurrentUser() user: AuthUser, @Body() dto: SaticiSozlesmeOnaylaDto, @Req() req: Request) {
    // IP ve cihaz KANITTIR: istemciden degil sunucudan alinir
    // (load.controller'daki sozlesme onayiyla ayni desen).
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    const cihaz = req.headers['user-agent'];
    const r = await this.market.saticiSozlesmeOnayla(user.id, dto.sozlesmeTipi, ip, cihaz);
    await this.audit.record({ actorId: user.id, action: 'seller.sozlesme.onay', entity: 'SozlesmeOnay', entityId: r.id, ip, metadata: { tip: dto.sozlesmeTipi, surum: r.surum } });
    return r;
  }

  // ---------------- MAGAZA PERSONELI ----------------
  // Yetki bu uclarda DAHA DAR: magaza sahibi ya da platform yoneticisi
  // (market.service.sahipVeyaYonetici). Personelin personel eklemesi kapali.
  // Audit controller katmaninda (kural 7).

  @Get('stores/:id/users')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  personelListesi(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string) {
    return this.market.personelListesi(id, user.id, user.roles);
  }

  @Post('stores/:id/users')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_WRITE)
  async personelEkle(@CurrentUser() user: AuthUser, @Param('id', UuidParam) id: string, @Body() dto: PersonelEkleDto, @Req() req: Request) {
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
    @Param('id', UuidParam) id: string,
    @Param('userId', UuidParam) userId: string,
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
    @Param('id', UuidParam) id: string,
    @Param('userId', UuidParam) userId: string,
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
    @Param('id', UuidParam) id: string,
    @Param('userId', UuidParam) userId: string,
    // :role BILEREK HAM: Role enum degeri, UUID DEGIL. Dogrulamasi serviste
    // atanabilirRolDogrula() ile yapiliyor (beyaz liste disi -> 400).
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
