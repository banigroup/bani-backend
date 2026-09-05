import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { CacheModule } from '@nestjs/cache-manager';
import { redisInsStore } from 'cache-manager-ioredis-yet';
import Redis from 'ioredis';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './common/rbac/rbac.module';
import { AuditModule } from './common/audit/audit.module';
import { OnbellekModule } from './common/cache/onbellek.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AddressModule } from './address/address.module';
import { FinanceModule } from './finance/finance.module';
import { MarketModule } from './market/market.module';
import { CatalogModule } from './catalog/catalog.module';
import { CartModule } from './cart/cart.module';
import { OrdersModule } from './orders/orders.module';
import { DeliveryModule } from './delivery/delivery.module';
import { LoadModule } from './load/load.module';
import { SuperadminModule } from './superadmin/superadmin.module';
import { PartnerModule } from './partner/partner.module';
import { SigortaModule } from './sigorta/sigorta.module';
import { HealthModule } from './health/health.module';
import { NewsletterModule } from './newsletter/newsletter.module';
@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // ScheduleModule BILEREK YOK — cron'lar WORKER surecinde calisiyor
    // (src/worker.module.ts). @Cron dekoratoru tek basina bir sey yapmaz;
    // metadatayi zamanlayiciya baglayan ScheduleModule'dur. Burada
    // olmadigi icin API surecinde HICBIR cron tetiklenmez - kapatma
    // yapisal, unutulabilecek bir ortam degiskenine bagli degil.
    // ---------------- ONBELLEK (Redis) ----------------
    //
    // isGlobal: CACHE_MANAGER her dilimden enjekte edilebilsin (bugun yalnizca
    // OnbellekService kullaniyor, ama interceptor da global cozumleme yapiyor).
    //
    // BAGLANTI URL'DEN: Railway'de REDIS_URL degiskeni bani-backend'e bagli.
    // Yerelde .env'de yoksa docker-compose'daki redis'e dusulur - gelistirici
    // ek kurulum yapmadan calissin diye. Sunucuda degisken YOKSA sessizce
    // localhost'a dusmek yanlis olurdu; ama Railway'de degisken bagli oldugu
    // icin bu dal yalnizca yerelde isler.
    //
    // redisInsStore + kendi ioredis ornegimiz: baglanti dizesini ioredis
    // dogrudan anliyor (redisStore'un secenek tipi url almiyor) ve store'un
    // altindaki istemciye erisim OnbellekService'in desen-silmesi icin gerekli.
    //
    // TTL MILISANIYE (cache-manager v5). Varsayilan 30 sn; uc bazinda
    // @CacheTTL ile eziliyor.
    //
    // REDIS DUSERSE UC KIRILMAZ: @nestjs/cache-manager'in CacheInterceptor'i
    // get/set'i try/catch icinde cagirip hata halinde istegi normal akisa
    // birakiyor (dogrulandi: dist/interceptors/cache.interceptor.js). Yani
    // onbellek bir HIZLANDIRMA katmani, tek hata noktasi degil.
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: () => ({
        store: redisInsStore(new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')),
        ttl: 30_000,
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    RbacModule,
    AuditModule,
    OnbellekModule,
    AuthModule,
    UsersModule,
    AddressModule,
    FinanceModule,
    MarketModule,
    CatalogModule,
    CartModule,
    OrdersModule,
    DeliveryModule,
    LoadModule,
    PartnerModule,
    SuperadminModule,
    SigortaModule,
    HealthModule,
    NewsletterModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
