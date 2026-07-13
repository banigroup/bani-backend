import { Module } from '@nestjs/common';
import { SigortaService } from './sigorta.service';
import { SigortaController } from './sigorta.controller';
@Module({
  controllers: [SigortaController],
  providers: [SigortaService],
})
export class SigortaModule {}
