import { Global, Module } from '@nestjs/common';
import { OnbellekService } from './onbellek.service';

/**
 * AuditModule ile ayni desen: @Global, cunku onbellek temizligi yazma ucu olan
 * HER dilimden cagrilabilmeli (bugun catalog + market) ve her modulun ayri ayri
 * import etmesi gereksiz gurultu olurdu.
 *
 * CacheModule'un KENDISI app.module'de kayitli (isGlobal:true); bu modul
 * yalnizca desen-silme yardimcisini tasiyor.
 */
@Global()
@Module({
  providers: [OnbellekService],
  exports: [OnbellekService],
})
export class OnbellekModule {}
