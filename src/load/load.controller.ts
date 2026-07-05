import {
  Controller, Get, Post, Patch, Body, Param, UseGuards, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { SozlesmeTipi } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { LoadService } from './load.service';
import { YukIlaniOlusturDto } from './dto/yuk-ilani-olustur.dto';
import { AracIlaniOlusturDto } from './dto/arac-ilani-olustur.dto';
import { TeklifVerDto } from './dto/teklif-ver.dto';
import { KomisyonBildirDto } from './dto/komisyon-bildir.dto';
import { SozlesmeOnaylaDto } from './dto/sozlesme-onayla.dto';
import { LoadProfilKaydetDto } from './dto/load-profil-kaydet.dto';

@Controller('load')
@UseGuards(JwtAuthGuard)
export class LoadController {
  constructor(private readonly load: LoadService) {}

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
  ilanIptal(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.load.ilanIptal(user, id);
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
  aracKapat(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.load.aracIlaniKapat(user, id);
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
  teklifKabul(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    const cihaz = req.headers['user-agent'];
    return this.load.teklifKabul(user, id, ip, cihaz);
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
komisyonBildir(@CurrentUser() user: AuthUser, @Body() dto: KomisyonBildirDto) {
  return this.load.komisyonBildir(user, dto);
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
komisyonOnayla(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { adminNot?: string }) {
  return this.load.komisyonOnayla(user, id, body?.adminNot);
}

@Patch('komisyon/:id/reddet') // admin
komisyonReddet(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { adminNot?: string }) {
  return this.load.komisyonReddet(user, id, body?.adminNot);
}


// ----- Sozlesme onay (B modeli) -----
@Get('sozlesme/durum/:tip') // kullanici: belirli tip icin onay durumu
sozlesmeDurum(@CurrentUser() user: AuthUser, @Param('tip') tip: SozlesmeTipi) {
  return this.load.sozlesmeDurumu(user, tip);
}

@Post('sozlesme/onayla') // kullanici: uyelik sozlesmesini onayla (IP/cihaz sunucudan)
sozlesmeOnayla(@CurrentUser() user: AuthUser, @Body() dto: SozlesmeOnaylaDto, @Req() req: Request) {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
  const cihaz = req.headers['user-agent'];
  return this.load.sozlesmeOnayla(user, dto.sozlesmeTipi, ip, cihaz);
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
}
