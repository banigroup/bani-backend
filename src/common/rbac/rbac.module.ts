import { Global, Module } from '@nestjs/common';
import { IzinMatrisi } from './izin-matrisi.service';

/**
 * PermissionsGuard 59 uctan @UseGuards(...) ile SINIF olarak veriliyor; Nest onu
 * kullanildigi modulun context'inde olusturur. Bagimliligi (IzinMatrisi) her
 * modulde cozulebilsin diye modul GLOBAL - PrismaModule ile ayni gerekce.
 */
@Global()
@Module({
  providers: [IzinMatrisi],
  exports: [IzinMatrisi],
})
export class RbacModule {}
