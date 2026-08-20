import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from './permissions.enum';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { IzinMatrisi } from './izin-matrisi.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly matris: IzinMatrisi,
  ) {}

  // A2: matris artik kod haritasindan degil role_permissions tablosundan geliyor,
  // bu yuzden canActivate ASENKRON. Karar mantigi degismedi: istenen izinlerin
  // TAMAMI kullanicinin rollerinden geliyorsa gecer.
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required || required.length === 0) return true;
    const { user } = ctx.switchToHttp().getRequest();
    const granted = await this.matris.izinler(user?.roles ?? []);
    if (!required.every((p) => granted.has(p))) throw new ForbiddenException('Yetersiz izin');
    return true;
  }
}
