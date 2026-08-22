import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SentryModule } from '@sentry/nestjs/setup';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './common/rbac/rbac.module';
import { AuditModule } from './common/audit/audit.module';
import { KuyrukModule } from './kuyruk/kuyruk.module';
import { LoadModule } from './load/load.module';

/**
 * WORKER SURECI — ARKA PLAN ISLERI.
 *
 * NEDEN AYRI SUREC: API ile cron'lar tek Node process'inde calisiyordu; bir
 * dikeyin arka plan isi (or. LOAD saatlik temizligi) event loop'u mesgul
 * ettiginde baska bir dikeyin checkout'u onun arkasinda bekliyordu. Blast
 * radius'u daraltmak icin islerin process'i ayrildi; DAVRANIS DEGISMEDI -
 * ayni cron'lar ayni araliklarla ayni isi yapiyor.
 *
 * CRON'LARIN API'DE CALISMAMASINI SAGLAYAN SEY: ScheduleModule.forRoot()
 * ARTIK YALNIZ BURADA. @Cron dekoratoru tek basina bir sey yapmaz - metadata
 * yazar; o metadatayi toplayip zamanlayiciya baglayan ScheduleModule'dur.
 * app.module.ts'ten kaldirildigi icin API surecinde hicbir cron tetiklenmez.
 * (Bu, "cron'lari kapatan bir bayrak" eklemekten daha guvenli: unutulabilecek
 * bir ortam degiskeni yok, kapatma yapisal.)
 *
 * NEDEN BU IKI MODUL: bugun @Cron tasiyan tek iki servis KuyrukService
 * (EVERY_MINUTE) ve LoadService (EVERY_HOUR). Yeni bir cron eklenirse onun
 * modulu de buraya eklenmeli - aksi halde SESSIZCE hic calismaz.
 * ConfigModule/Prisma/Rbac/Audit, bu iki modulun bagimlilik zinciri icin.
 */
@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RbacModule,
    AuditModule,
    KuyrukModule,
    LoadModule,
  ],
})
export class WorkerModule {}
