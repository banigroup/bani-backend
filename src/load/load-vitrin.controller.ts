import { Controller, Get, Query } from '@nestjs/common';
import { LoadService } from './load.service';

// Giris gerektirmeyen vitrin uclari (ana sayfa icin).
// Ana LoadController guard'lidir; bu controller ayridir ve guard yoktur.
@Controller('load/vitrin')
export class LoadVitrinController {
  constructor(private readonly load: LoadService) {}

  @Get('son-ilanlar')
  sonIlanlar() {
    return this.load.vitrinSonIlanlar();
  }
  @Get('son-araclar')
  sonAraclar() {
    return this.load.vitrinSonAraclar();
  }

  @Get('ilan-borsasi')
  ilanBorsasi(@Query('sayfa') sayfa?: string, @Query('nereden') nereden?: string, @Query('nereye') nereye?: string, @Query('aracTipi') aracTipi?: string) {
    return this.load.ilanBorsasi({ sayfa: sayfa ? parseInt(sayfa, 10) : 1, nereden, nereye, aracTipi });
  }

  @Get('arac-borsasi')
  aracBorsasi(@Query('sayfa') sayfa?: string, @Query('nereden') nereden?: string, @Query('nereye') nereye?: string, @Query('aracTipi') aracTipi?: string) {
    return this.load.aracBorsasi({ sayfa: sayfa ? parseInt(sayfa, 10) : 1, nereden, nereye, aracTipi });
  }
}