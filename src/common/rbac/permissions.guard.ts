import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Permission } from './permissions.enum';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { IzinMatrisi } from './izin-matrisi.service';

/**
 * FAZ 1 / B1 — MAGAZA ROLLERINDEN GECEBILECEK IZINLER, KODDA SABIT.
 *
 * Izin matrisi A2'den beri PANELDEN yonetiliyor. Operasyon/IK bir magaza
 * rolune yanlislikla `user:read` verirse, kesisim olmasaydi o kisi butun
 * kullanici listesini gorurdu - `/users` ucunda serviste ikinci bir kontrol
 * YOK, guard tek kapi. Bu liste tam olarak o hatadan koruyor; veride degil
 * KODDA cunku korundugumuz sey panelden yapilan hata.
 *
 * Emsal: catalog.service.VITRIN_URUN_ALANLARI - ayni gerekce (sizmasi
 * istenmeyen alan kumesi koda yazilir, veriye birakilmaz).
 *
 * NEDEN BU UC IZIN: B0 envanterinde bu uclerin istendigi TUM uclarin
 * (24 uc) magaza kapisindan (assertOwner / erisebilir) gectigi tek tek
 * dogrulandi. store:write LISTEYE ALINMADI: POST /market/stores'un kapisi
 * yok (magaza henuz yaratilmamis), listeye girseydi magaza personeli kendi
 * adina yeni magaza acabilirdi. Magaza ayari ihtiyaci dogarsa AYRI bir izin
 * (store:settings:write) tanimlanir, store:write genisletilmez.
 */
export const MAGAZA_ROLU_IZIN_BEYAZ_LISTESI: ReadonlySet<Permission> = new Set([
  Permission.PRODUCT_WRITE,
  Permission.CATEGORY_WRITE,
  Permission.ORDER_MANAGE,
]);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly matris: IzinMatrisi,
  ) {}

  // A2: matris kod haritasindan degil role_permissions tablosundan geliyor,
  // bu yuzden canActivate ASENKRON.
  //
  // B1: magaza rolleri de hesaba katiliyor ama HANGI magaza oldugu burada
  // SORULMUYOR. Sebep: "hangi magaza" sorusunu zaten market.erisebilir /
  // assertOwner cevapliyor ve magaza izni isteyen her uc oradan geciyor
  // (B0'da 24/24 dogrulandi). Guard'in cevapladigi soru daha dar: "bu kisi
  // HERHANGI bir magazada bu isi yapabilir mi". Iki kapi SERI calisir:
  // guard gecse bile yanlis magazada assertOwner keser.
  //
  // Boylece guard'a magaza baglami cozumleyicisi ve 20 ucta ek turetme sorgusu
  // eklemek gerekmedi - servis zaten ayni kaynagi okuyup assertOwner cagiriyor,
  // o is iki kez yapilmis olurdu.
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required || required.length === 0) return true;
    const { user } = ctx.switchToHttp().getRequest();

    const granted = await this.matris.izinler(user?.roles ?? []);

    // Magaza rollerinin katkisi: yalnizca beyaz listedekiler. Ayni onbellekten
    // okunur, YENI SORGU YOK (bkz. IzinMatrisi - matris rol->izin haritasi,
    // kullanicidan ve magazadan bagimsiz).
    // user request'ten geliyor (any); AuthUser.magazaRolleri sozlesmesi
    // jwt.strategy'de uretiliyor - tip burada aciklaniyor.
    const magazaRolleri: Role[] = Object.values((user?.magazaRolleri ?? {}) as Record<string, Role[]>).flat();
    if (magazaRolleri.length > 0) {
      const magazadan = await this.matris.izinler(magazaRolleri);
      for (const izin of magazadan) {
        if (MAGAZA_ROLU_IZIN_BEYAZ_LISTESI.has(izin as Permission)) granted.add(izin);
      }
    }

    if (!required.every((p) => granted.has(p))) throw new ForbiddenException('Yetersiz izin');
    return true;
  }
}
