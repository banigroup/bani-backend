import { Module } from '@nestjs/common';
import { LoadService } from './load.service';
import { LoadController } from './load.controller';
import { LoadVitrinController } from './load-vitrin.controller';
import { FinanceModule } from '../finance/finance.module';
import { SozlesmeModule } from '../sozlesme/sozlesme.module';
import { BildirimModule } from '../bildirim/bildirim.module';
import { KuyrukModule } from '../kuyruk/kuyruk.module';
import { EvdenEveService } from './evdeneve.service';
import { EvdenEveController } from './evdeneve.controller';

@Module({
  // SigortaModule BILEREK YOK: sigorta baska bir dikey (holding ilkesi).
  // BaniSigorta lead'i is kuyruguna birakilir; tuketen taraf KuyrukService'tir.
  imports: [FinanceModule, SozlesmeModule, BildirimModule, KuyrukModule],
  controllers: [LoadController, LoadVitrinController, EvdenEveController],
  providers: [LoadService, EvdenEveService],
  exports: [LoadService],
})
export class LoadModule { }
