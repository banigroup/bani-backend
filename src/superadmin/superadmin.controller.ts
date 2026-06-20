import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperadminService } from './superadmin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { RequirePermissions } from '../common/rbac/permissions.decorator';
import { Permission } from '../common/rbac/permissions.enum';

@Controller('superadmin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.FINANCE_READ)
export class SuperadminController {
  constructor(private readonly superadmin: SuperadminService) { }

  @Get('overview')
  overview() {
    return this.superadmin.overview();
  }
}