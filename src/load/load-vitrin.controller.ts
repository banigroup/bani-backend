import { Controller, Get } from '@nestjs/common';
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
}