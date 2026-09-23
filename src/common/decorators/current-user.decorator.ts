import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { BusinessUnit, Role } from '@prisma/client';
import { dikeyAyristir } from '../domain/dikey-domain';

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

/**
 * VERT-01 — SATICI PANELININ AKTIF DIKEYI: yalnizca X-Bani-Dikey basligi.
 *
 * Origin BILEREK okunmaz: panel markali bir domainde calismiyor, baglami
 * panelin kendisi bildirir. Baslik yoksa, tekrarlanmissa (dizi) ya da
 * BusinessUnit degeri degilse null doner; nasil karsilanacagina magaza kapisi
 * (MarketService.dikeyKapisi) karar verir - burada hata firlatilmaz ki muaf
 * uclar (basvuru, bootstrap) bu dekoratoru hic kullanmasin, kullansa da kirilmasin.
 */
export function istekDikeyiCoz(_: unknown, ctx: ExecutionContext): BusinessUnit | null {
  const baslik = ctx.switchToHttp().getRequest().headers?.['x-bani-dikey'];
  return typeof baslik === 'string' ? dikeyAyristir(baslik) : null;
}

/** Cozucu ayri export edildi: testler hangi ucun dikey bagli oldugunu metadata'dan dogrular. */
export const IstekDikeyi = createParamDecorator(istekDikeyiCoz);
