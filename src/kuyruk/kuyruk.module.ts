import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BildirimModule } from '../bildirim/bildirim.module';
import { SigortaModule } from '../sigorta/sigorta.module';
import { KuyrukService } from './kuyruk.service';

// Kuyruk CEKIRDEK katmandir: dikeylerin isini tuketir, hicbir dikeye ait degildir.
// Dikeyler arasi bag buradan gecer - load, sigorta'yi dogrudan import etmez.
@Module({
  imports: [PrismaModule, BildirimModule, SigortaModule],
  providers: [KuyrukService],
  exports: [KuyrukService],
})
export class KuyrukModule {}