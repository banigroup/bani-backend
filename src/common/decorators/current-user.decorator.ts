import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  phone: string;

  // PLATFORM ROLLERI — yalnizca user_roles.storeId IS NULL olan satirlar.
  // Faz 1/C1'de anlami DARALDI: eskiden "kullanicinin tum rolleri" idi, artik
  // "kapsamsiz, platform geneli rolleri". Ad ayni birakildi cunku 59 uctaki
  // izin kontrolu ve @Roles dekoratoru tam olarak bu kumeye bakmali; adi
  // degistirmek 100'den fazla cagri yerini dokunmayi gerektirirdi ve C1'in
  // "davranis degismez" sozunu bozardi. Bugun fark yok (her satir NULL),
  // magaza kapsamli ilk satir yazildigi gun kritik.
  roles: Role[];

  // MAGAZA ROLLERI — storeId IS NOT NULL satirlar, magazaya gore gruplu.
  // C1'de HIC OKUNMUYOR (guard'a baglanmadi, bkz. C1 kapsam disi listesi);
  // yetkilendirmede kullanilmasi C4'un isi. Buradaki bir rol ASLA platform
  // yetkisi vermez.
  magazaRolleri: Record<string, Role[]>;
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser | unknown => {
    const req = ctx.switchToHttp().getRequest();
    return data ? req.user?.[data] : req.user;
  },
);
