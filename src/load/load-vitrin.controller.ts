import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { LoadService } from './load.service';
import { EvdenEveService } from './evdeneve.service';

// Giris gerektirmeyen vitrin uclari (ana sayfa icin).
// Ana LoadController guard'lidir; bu controller ayridir ve guard yoktur.
@Controller('load/vitrin')
export class LoadVitrinController {
  constructor(private readonly load: LoadService, private readonly ev: EvdenEveService) {}

  @Public()
  @Get('son-ilanlar')
  sonIlanlar() {
    return this.load.vitrinSonIlanlar();
  }
  @Public()
  @Get('ev-ilanlari')
  evIlanlari() {
    return this.ev.vitrinEvIlanlari();
  }
  @Public()
  @Get('son-araclar')
  sonAraclar() {
    return this.load.vitrinSonAraclar();
  }

  @Public()
  @Get('ilan-borsasi')
  ilanBorsasi(@Query('sayfa') sayfa?: string, @Query('nereden') nereden?: string, @Query('nereye') nereye?: string, @Query('aracTipi') aracTipi?: string) {
    return this.load.ilanBorsasi({ sayfa: sayfa ? parseInt(sayfa, 10) : 1, nereden, nereye, aracTipi });
  }

  @Public()
  @Get('arac-borsasi')
  aracBorsasi(@Query('sayfa') sayfa?: string, @Query('nereden') nereden?: string, @Query('nereye') nereye?: string, @Query('aracTipi') aracTipi?: string) {
    return this.load.aracBorsasi({ sayfa: sayfa ? parseInt(sayfa, 10) : 1, nereden, nereye, aracTipi });
  }
}
