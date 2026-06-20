import { Module } from '@nestjs/common';
import { SuperadminController } from './superadmin.controller';
import { SuperadminService } from './superadmin.service';

// PrismaModule global oldugu icin (app.module'de import edilmis) burada
// PrismaService'i ayrica provide etmeye gerek yok — sadece enjekte ediyoruz.
@Module({
  controllers: [SuperadminController],
  providers: [SuperadminService],
})
export class SuperadminModule {}
