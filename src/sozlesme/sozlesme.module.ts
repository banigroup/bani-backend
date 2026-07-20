import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SozlesmeService } from './sozlesme.service';

@Module({
  imports: [PrismaModule],
  providers: [SozlesmeService],
  exports: [SozlesmeService],
})
export class SozlesmeModule {}