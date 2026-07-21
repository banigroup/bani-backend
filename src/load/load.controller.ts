import {
  Controller, Get, Post, Patch, Body, Param, UseGuards, Req, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { SozlesmeTipi, Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/rbac/roles.guard';
import { Roles } from '../common/rbac/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { LoadService } from './load.service';
import { AuditService } from '../common/audit/audit.service';
import { KuyrukService } from '../kuyruk/kuyruk.service';
import { YukIlaniOlusturDto } from './dto/yuk-ilani-olustur.dto';
import { AracIlaniOlusturDto } from './dto/arac-ilani-olustur.dto';
import { TeklifVerDto } from './dto/teklif-ver.dto';
import { KomisyonBildirDto } from './dto/komisyon-bildir.dto';
import { SozlesmeOnaylaDto } from './dto/sozlesme-onayla.dto';
import { LoadProfilKaydetDto } from './dto/load-profil-kaydet.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { cloudinaryUpload } from './cloudinary.util';

@Controller('load')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CARRIER, Role.LOAD_CUSTOMER)
export class LoadController {
  constructor(private readonly load: LoadService, private readonly audit: AuditService, private readonly kuyruk: KuyrukService) { }

  // ----- Yuk ilani -----
  @Post('ilan')
  ilanOlustur(@CurrentUser() user: AuthUser, @Body() dto: YukIlaniOlusturDto) {
    return this.load.ilanOlustur(user, dto);
  }

  @Get('ilanlar') // acik ilanlar (tasiyici gorur)
  acikIlanlar() {
    return this.load.acikIlanlar();
  }

  @Get('ilanlarim') // yuk verenin kendi ilanlari + teklifler
  ilanlarim(@CurrentUser() user: AuthUser) {
    return this.load.ilanlarim(user);
  }

  @Get('ilan/:id')
  ilanDetay(@Param('id') id: string) {
    return this.load.ilanDetay(id);
  }

  @Patch('ilan/:id/iptal')
  async ilanIptal(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const r = await this.load.ilanIptal(user, id);
    await this.audit.record({ actorId: user.id, action: 'load.yuk.iptal', entity: 'YukIlani', entityId: id });
    return r;
  }

  // ----- Arac ilani -----
  @Post('arac')
  aracOlustur(@CurrentUser() user: AuthUser, @Body() dto: AracIlaniOlusturDto) {
    return this.load.aracIlaniOlustur(user, dto);
  }

  @Get('araclar') // musait araclar
  musaitAraclar() {
    return this.load.musaitAraclar();
  }

  @Get('araclarim')
  araclarim(@CurrentUser() user: AuthUser) {
    return this.load.araclarim(user);
  }

  @Patch('arac/:id/kapat')
  async aracKapat(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const r = await this.load.aracIlaniKapat(user, id);
    await this.audit.record({ actorId: user.id, action: 'load.arac.kapat', entity: 'AracIlani', entityId: id });
    return r;
  }


  // ----- Arac Teklif (firma -> arac, kamyoncu onaylar) -----
  @Post('arac-teklif')
  aracTeklifVer(@CurrentUser() user: AuthUser, @Body() dto: { aracIlaniId: string; fiyatKurus: number; mesaj?: string }) {
    return this.load.aracTeklifVer(user, dto);
  }

  @Get('arac-tekliflerim')
  aracTekliflerim(@CurrentUser() user: AuthUser) {
    return this.load.aracTekliflerim(user);
  }

  @Patch('arac-teklif/:id/geri-cek')
  aracTeklifGeriCek(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.load.aracTeklifGeriCek(user, id);
  }

  @Patch('arac-teklif/:id/kabul')
  async aracTeklifKabul(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || undefined;
    const cihaz = (req.headers['user-agent'] as string) || undefined;
    const r = await this.load.aracTeklifKabul(user, id, ip, cihaz);
    await this.audit.record({ actorId: user.id, action: 'load.arac.kabul', entity: 'AracTeklif', entityId: id, ip });
    const aVeren = (r as any)?.seciliTeklif?.veren; const aTas = (r as any)?.tasiyici;
    const aTel = aVeren?.id !== user.id ? aVeren?.phone : aTas?.phone;
    if (aTel) await this.kuyruk.ekle('BILDIRIM_SMS', { alici: aTel, sablonKodu: 'TEKLIF_KABUL', degiskenler: { ilan: ((r as any)?.nereden ?? '') + ' - ' + ((r as any)?.nereye ?? '') } });
    return r;
  }

  @Patch('arac-teklif/:id/reddet')
  aracTeklifReddet(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.load.aracTeklifReddet(user, id);
  }

  @Patch('arac-teklif/:id/karsi')
  aracKarsiTeklif(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { yeniFiyatKurus: number }) {
    return this.load.aracKarsiTeklif(user, id, body.yeniFiyatKurus);
  }

  @Patch('arac/:id/teslim-beyan') // kamyoncu (arac sahibi) teslim ettim
  aracTeslimBeyan(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.load.aracTeslimBeyan(user, id);
  }

  @Patch('arac/:id/teslim-onay') // firma (teklifi veren) teslim onayla + komisyon
  async aracTeslimOnay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const r = await this.load.aracTeslimOnay(user, id);
    await this.audit.record({ actorId: user.id, action: 'load.arac.teslimOnay', entity: 'AracIlani', entityId: id });
    return r;
  }

  // ----- Teklif -----
  @Post('teklif')
  teklifVer(@CurrentUser() user: AuthUser, @Body() dto: TeklifVerDto) {
    return this.load.teklifVer(user, dto);
  }

  @Get('tekliflerim')
  tekliflerim(@CurrentUser() user: AuthUser) {
    return this.load.tekliflerim(user);
  }

  @Patch('teklif/:id/geri-cek')
  teklifGeriCek(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.load.teklifGeriCek(user, id);
  }

  @Patch('teklif/:id/kabul') // ESLESTIRME
  async teklifKabul(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    const cihaz = req.headers['user-agent'];
    const r = await this.load.teklifKabul(user, id, ip, cihaz);
    await this.audit.record({ actorId: user.id, action: 'load.yuk.kabul', entity: 'YukTeklif', entityId: id, ip });
    const yTel = (r as any)?.seciliTeklif?.tasiyici?.phone;
    if (yTel) await this.kuyruk.ekle('BILDIRIM_SMS', { alici: yTel, sablonKodu: 'TEKLIF_KABUL', degiskenler: { ilan: ((r as any)?.nereden ?? '') + ' - ' + ((r as any)?.nereye ?? '') } });
    return r;
  }

  @Patch('teklif/:id/reddet')
  teklifReddet(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.load.teklifReddet(user, id);
  }
  @Patch('teklif/:id/karsi')
  yukKarsiTeklif(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { yeniFiyatKurus: number }) {
    return this.load.yukKarsiTeklif(user, id, body.yeniFiyatKurus);
  }
  // ----- Is akisi -----
  @Patch('ilan/:id/basla')
  tasimaBasla(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.load.tasimaBasla(user, id);
  }

  @Patch('ilan/:id/tamamla')
  tasimaTamamla(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.load.tasimaTamamla(user, id);
  }

  // ----- Komisyon borc + tahsilat -----
  @Get('komisyon/durum') // tasiyici: borc durumu (borc, esik, kilitli)
  komisyonDurum(@CurrentUser() user: AuthUser) {
    return this.load.komisyonDurumu(user);
  }

  @Post('komisyon/bildir') // tasiyici: havale bildirimi
  async komisyonBildir(@CurrentUser() user: AuthUser, @Body() dto: KomisyonBildirDto) {
    const r = await this.load.komisyonBildir(user, dto);
    await this.audit.record({ actorId: user.id, action: 'load.komisyon.bildir', entity: 'KomisyonOdeme', entityId: (r as any)?.id ?? null });
    return r;
  }

  @Get('komisyon/odemelerim') // tasiyici: kendi bildirimleri
  komisyonOdemelerim(@CurrentUser() user: AuthUser) {
    return this.load.odemelerim(user);
  }

  @Get('komisyon/bekleyenler') // admin: onay bekleyen bildirimler
  komisyonBekleyenler(@CurrentUser() user: AuthUser) {
    return this.load.bekleyenOdemeler(user);
  }

  @Patch('komisyon/:id/onayla') // admin
  async komisyonOnayla(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { adminNot?: string }) {
    const r = await this.load.komisyonOnayla(user, id, body?.adminNot);
    await this.audit.record({ actorId: user.id, action: 'load.komisyon.onay', entity: 'KomisyonOdeme', entityId: id, metadata: { adminNot: body?.adminNot ?? null } });
    return r;
  }

  @Patch('komisyon/:id/reddet') // admin
  async komisyonReddet(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { adminNot?: string }) {
    const r = await this.load.komisyonReddet(user, id, body?.adminNot);
    await this.audit.record({ actorId: user.id, action: 'load.komisyon.red', entity: 'KomisyonOdeme', entityId: id, metadata: { adminNot: body?.adminNot ?? null } });
    return r;
  }


  // ----- Sozlesme onay (B modeli) -----
  @Get('sozlesme/durum/:tip') // kullanici: belirli tip icin onay durumu
  sozlesmeDurum(@CurrentUser() user: AuthUser, @Param('tip') tip: SozlesmeTipi) {
    return this.load.sozlesmeDurumu(user, tip);
  }

  @Post('sozlesme/onayla') // kullanici: uyelik sozlesmesini onayla (IP/cihaz sunucudan)
  async sozlesmeOnayla(@CurrentUser() user: AuthUser, @Body() dto: SozlesmeOnaylaDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    const cihaz = req.headers['user-agent'];
    const r = await this.load.sozlesmeOnayla(user, dto.sozlesmeTipi, ip, cihaz);
    await this.audit.record({ actorId: user.id, action: 'sozlesme.onay', entity: 'SozlesmeOnay', entityId: (r as any)?.id ?? null, ip, metadata: { tip: dto.sozlesmeTipi } });
    return r;
  }


  // ----- KYC Profil -----
  @Post('profil')
  profilKaydet(@CurrentUser() user: AuthUser, @Body() dto: LoadProfilKaydetDto) {
    return this.load.profilKaydet(user, dto);
  }

  @Get('profil/durum')
  profilDurumu(@CurrentUser() user: AuthUser) {
    return this.load.profilDurumu(user);
  }

  // ----- KYC Belge yukleme (Cloudinary) -----
  @Post('belge')
  @UseInterceptors(FileInterceptor('dosya'))
  async belgeYukle(
    @CurrentUser() user: AuthUser,
    @UploadedFile() dosya: any,
    @Body('tip') tip: string,
  ) {
    if (!dosya) throw new BadRequestException('Dosya gerekli');
    const url = await cloudinaryUpload(dosya.buffer, `baniload/${user.id}`);
    return this.load.belgeKaydet(user, tip, url);
  }

  @Get('belgelerim')
  belgelerim(@CurrentUser() user: AuthUser) {
    return this.load.belgelerim(user);
  }

  // ----- ADMIN: Belge onay -----
  @Get('admin/belgeler/bekleyenler')
  bekleyenBelgeler(@CurrentUser() user: AuthUser) {
    return this.load.bekleyenBelgeler(user);
  }

  @Patch('belge/:id/onayla')
  async belgeOnayla(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const r = await this.load.belgeOnayla(user, id);
    await this.audit.record({ actorId: user.id, action: 'load.belge.onay', entity: 'LoadBelge', entityId: id });
    return r;
  }

  @Patch('belge/:id/reddet')
  async belgeReddet(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { gerekce?: string }) {
    const r = await this.load.belgeReddet(user, id, body?.gerekce);
    await this.audit.record({ actorId: user.id, action: 'load.belge.red', entity: 'LoadBelge', entityId: id, metadata: { gerekce: body?.gerekce ?? null } });
    return r;
  }

  @Post('degerlendir')
  degerlendir(@CurrentUser() user: AuthUser, @Body() body: { yukIlaniId?: string; aracIlaniId?: string; puan: number }) {
    return this.load.degerlendir(user, body);
  }
  @Get('degerlendirmelerim')
  degerlendirmelerim(@CurrentUser() user: AuthUser) {
    return this.load.degerlendirmelerim(user);
  }
}
