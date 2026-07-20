import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BildirimService } from './bildirim.service';
import { SMS_PROVIDER } from './sms/sms-provider.interface';
import { ConsoleSmsProvider } from './sms/console-sms.provider';
import { IletiMerkeziSmsProvider } from './sms/iletimerkezi-sms.provider';

@Module({
  imports: [PrismaModule],
  providers: [
    BildirimService,
    { provide: SMS_PROVIDER, useClass: process.env.SMS_AKTIF === 'true' ? IletiMerkeziSmsProvider : ConsoleSmsProvider },
  ],
  exports: [BildirimService, SMS_PROVIDER],
})
export class BildirimModule {}