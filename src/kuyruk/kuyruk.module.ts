import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BildirimModule } from '../bildirim/bildirim.module';
import { KuyrukService } from './kuyruk.service';

@Module({
  imports: [PrismaModule, BildirimModule],
  providers: [KuyrukService],
  exports: [KuyrukService],
})
export class KuyrukModule {}