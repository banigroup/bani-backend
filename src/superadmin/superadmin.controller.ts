import { Controller, Get, UseGuards } from '@nestjs/common';
import { HoldingService } from '../holding/holding.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { RequirePermissions } from '../common/rbac/permissions.decorator';
import { Permission } from '../common/rbac/permissions.enum';

@Controller('superadmin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.FINANCE_READ)
export class SuperadminController {
  // SuperadminService BOSALDI ve SILINDI: tek metodu (overview) capraz-dikey
  // bir okumaydi ve HoldingService.ticaretOzeti olarak oraya tasindi.
  // Rota (/superadmin/overview), izin (FINANCE_READ) ve yanit govdesi AYNI.
  constructor(private readonly holding: HoldingService) { }

  @Get('overview')
  overview() {
    return this.holding.ticaretOzeti();
  }
}