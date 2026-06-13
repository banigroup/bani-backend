import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { UserStatus } from '@prisma/client';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { SetStatusDto } from './dto/set-status.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { RequirePermissions } from '../common/rbac/permissions.decorator';
import { Permission } from '../common/rbac/permissions.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.users.findById(user.id);
  }

  @Get()
  @RequirePermissions(Permission.USER_READ)
  list(@Query('skip') skip?: string, @Query('take') take?: string) {
    return this.users.list(Number(skip) || 0, Number(take) || 50);
  }

  @Get(':id')
  @RequirePermissions(Permission.USER_READ)
  get(@Param('id') id: string) {
    return this.users.findById(id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.USER_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Patch(':id/roles')
  @RequirePermissions(Permission.USER_ROLE_ASSIGN)
  assignRoles(@Param('id') id: string, @Body() dto: AssignRolesDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.users.assignRoles(id, dto.roles, { actorId: actor.id, ip: req.ip });
  }

  @Patch(':id/status')
  @RequirePermissions(Permission.USER_SUSPEND)
  setStatus(@Param('id') id: string, @Body() dto: SetStatusDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.users.setStatus(id, dto.status as UserStatus, { actorId: actor.id, ip: req.ip });
  }
}
