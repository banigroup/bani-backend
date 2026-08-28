import { Module } from '@nestjs/common';
import { SuperadminController } from './superadmin.controller';
import { HoldingModule } from '../holding/holding.module';
import { IzinYonetimController } from './izin-yonetim.controller';
import { IzinYonetimService } from './izin-yonetim.service';

// PrismaModule global oldugu icin (app.module'de import edilmis) burada
// PrismaService'i ayrica provide etmeye gerek yok — sadece enjekte ediyoruz.
@Module({
  // overview ucu HoldingService'e delege ediyor (Faz 0 / paket 2).
  imports: [HoldingModule],
  controllers: [SuperadminController, IzinYonetimController],
  providers: [IzinYonetimService],
})
export class SuperadminModule {}
