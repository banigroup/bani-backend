import { Body, Controller, Get, Patch, Post, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { RequirePermissions } from '../common/rbac/permissions.decorator';
import { Permission } from '../common/rbac/permissions.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../common/audit/audit.service';
import { DeliveryService } from './delivery.service';
import { AraciKurumDto } from './dto/araci-kurum.dto';
import { TeslimKoduDto } from './dto/teslim-kodu.dto';

@Controller('delivery')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly audit: AuditService,
  ) { }

  // HAVUZ OKUMALARI AUDIT'LENIR: bu iki uc, siparis basina kaba konum ve tutar
  // donduren TOPLU okumalar. Kimin havuzu ne sıklıkta cektigi daha once hicbir
  // yerde iz birakmiyordu (audit yalnizca claim/pickup/deliver/aracikurum
  // uzerindeydi). Kayit yalnizca servis basariyla donerse yazilir - reddedilen
  // istek audit'e girmez (kural 7 ile ayni desen).
  @RequirePermissions(Permission.DELIVERY_READ)
  @Get('available')
  async available(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const r = await this.delivery.available(user);
    await this.audit.record({ actorId: user.id, action: 'delivery.available.read', entity: 'Delivery', ip: req.ip, metadata: { kayit: r.length } });
    return r;
  }

  @RequirePermissions(Permission.DELIVERY_READ)
  @Get('cargo')
  async cargo(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const r = await this.delivery.cargoQueue(user);
    await this.audit.record({ actorId: user.id, action: 'delivery.cargo.read', entity: 'Delivery', ip: req.ip, metadata: { kayit: r.length } });
    return r;
  }

  @RequirePermissions(Permission.DELIVERY_CLAIM)
  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.delivery.mine(user, status);
  }

  // Audit controller katmanında (kural 7: tek kaynak, serviste ikinci kayıt YOK).
  // Kayıt yalnızca servis başarıyla dönerse yazılır — reddedilen (Conflict/Forbidden)
  // geçişler audit'e girmez.
  @RequirePermissions(Permission.DELIVERY_CLAIM)
  @Post(':id/claim')
  async claim(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const r = await this.delivery.claim(user, id);
    await this.audit.record({ actorId: user.id, action: 'delivery.claim', entity: 'Delivery', entityId: id, ip: req.ip });
    return r;
  }

  @RequirePermissions(Permission.DELIVERY_CLAIM)
  @Post(':id/pickup')
  async pickup(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const r = await this.delivery.pickup(user, id);
    await this.audit.record({ actorId: user.id, action: 'delivery.pickup', entity: 'Delivery', entityId: id, ip: req.ip });
    return r;
  }

  // Teslim kodu ZORUNLU: musteriden alinan 6 hane dogrulanmadan teslimat
  // kapanmaz ve escrow dagitilmaz (bkz. delivery.service.deliver).
  @RequirePermissions(Permission.DELIVERY_CLAIM)
  @Post(':id/deliver')
  async deliver(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: TeslimKoduDto, @Req() req: Request) {
    const r = await this.delivery.deliver(user, id, dto.teslimKod);
    await this.audit.record({ actorId: user.id, action: 'delivery.deliver', entity: 'Delivery', entityId: id, ip: req.ip });
    return r;
  }

  // Aracı kuruma devret (admin/süper admin) — admin panelinden çağrılır.
  // Rol kontrolü servis içinde (aracikurumaVer).
  @RequirePermissions(Permission.DELIVERY_MANAGE)
  @Patch(':id/aracikurum')
  async aracikurum(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AraciKurumDto, @Req() req: Request) {
    const r = await this.delivery.aracikurumaVer(user, id, dto.kargoFirmasi, dto.takipNo);
    await this.audit.record({ actorId: user.id, action: 'delivery.aracikurum', entity: 'Delivery', entityId: id, ip: req.ip, metadata: { kargoFirmasi: dto.kargoFirmasi, takipNo: dto.takipNo } });
    return r;
  }
}
