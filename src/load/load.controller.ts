import {
  Controller, Get, Post, Patch, Body, Param, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { LoadService } from './load.service';
import { YukIlaniOlusturDto } from './dto/yuk-ilani-olustur.dto';
import { AracIlaniOlusturDto } from './dto/arac-ilani-olustur.dto';
import { TeklifVerDto } from './dto/teklif-ver.dto';

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
  teklifKabul(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.load.teklifKabul(user, id);
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
}
