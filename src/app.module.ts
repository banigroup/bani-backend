import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './common/audit/audit.module';
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
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuditModule,
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
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
