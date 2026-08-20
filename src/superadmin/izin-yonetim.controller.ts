import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IzinYonetimService } from './izin-yonetim.service';
import { VerIzinDto } from './dto/ver-izin.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { RequirePermissions } from '../common/rbac/permissions.decorator';
import { Permission } from '../common/rbac/permissions.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../common/audit/audit.service';

/**
 * FAZ 1 / A2 adim 2 — SuperAdmin izin ekraninin ucu.
 *
 * Ayri controller: superadmin.controller.ts sinif duzeyinde FINANCE_READ
 * istiyor; izin yonetimi ondan farkli bir yetki (PERMISSION_MANAGE) ve farkli
 * bir sorumluluk. Ayni sinifa konsaydi metod dekoratoru sinif dekoratorunu
 * sessizce ezerdi - okuyan icin yaniltici olurdu.
 */
@Controller('superadmin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.PERMISSION_MANAGE)
export class IzinYonetimController {
  constructor(
    private readonly izinler: IzinYonetimService,
    private readonly audit: AuditService,
  ) {}

  /** Tanimli tum izinler. */
  @Get('permissions')
  tumIzinler() {
    return this.izinler.izinler();
  }

  /** Rol -> izin haritasinin tamami (panel ekrani tek cagriyla ciziyor). */
  @Get('permissions/matrix')
  matris() {
    return this.izinler.matrisOku();
  }

  @Get('roles/:role/permissions')
  rolIzinleri(@Param('role') role: string) {
    return this.izinler.rolIzinleri(role);
  }

  @Post('roles/:role/permissions')
  async ver(
    @CurrentUser() user: AuthUser,
    @Param('role') role: string,
    @Body() dto: VerIzinDto,
    @Req() req: Request,
  ) {
    const sonuc = await this.izinler.ver(role, dto.permission);
    // AUDIT TEK KAYNAK: kayit burada, serviste degil. degisti=false olan
    // (zaten vardi) girisim de yaziliyor - kim ne denedi izi kalsin.
    await this.audit.record({
      actorId: user.id,
      action: 'permission.grant',
      entity: 'Role',
      entityId: role,
      ip: req.ip,
      metadata: { permission: dto.permission, degisti: sonuc.degisti },
    });
    return sonuc;
  }

  @Delete('roles/:role/permissions/:permission')
  async al(
    @CurrentUser() user: AuthUser,
    @Param('role') role: string,
    @Param('permission') permission: string,
    @Req() req: Request,
  ) {
    const sonuc = await this.izinler.al(role, permission);
    await this.audit.record({
      actorId: user.id,
      action: 'permission.revoke',
      entity: 'Role',
      entityId: role,
      ip: req.ip,
      metadata: { permission, degisti: sonuc.degisti },
    });
    return sonuc;
  }
}
