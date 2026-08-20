import { Module } from '@nestjs/common';
import { SuperadminController } from './superadmin.controller';
import { SuperadminService } from './superadmin.service';
import { IzinYonetimController } from './izin-yonetim.controller';
import { IzinYonetimService } from './izin-yonetim.service';

// PrismaModule global oldugu icin (app.module'de import edilmis) burada
// PrismaService'i ayrica provide etmeye gerek yok — sadece enjekte ediyoruz.
@Module({
  controllers: [SuperadminController, IzinYonetimController],
  providers: [SuperadminService, IzinYonetimService],
})
export class SuperadminModule {}
