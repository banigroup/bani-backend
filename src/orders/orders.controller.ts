import { Controller, Post, Get, Patch, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { RequirePermissions } from '../common/rbac/permissions.decorator';
import { Permission } from '../common/rbac/permissions.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../common/audit/audit.service';
import { OrdersService } from './orders.service';
import { CheckoutDto } from './dto/checkout.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  // Origin, sepetteki magazanin dikeyiyle karsilastirilir (bkz. dikey-domain.ts):
  // kullanici bir markanin vitrininde baska markanin sepetiyle odeme yapamasin.
  @Post('checkout')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CheckoutDto, @Req() req: Request) {
    // X-Bani-Dikey: sepet dikeye kilitli oldugu icin hangi sepetle odeme
    // yapildigini ana domainden gelen istekte yalnizca istemci bildirebilir.
    return this.orders.checkout(user.id, dto, req.headers.origin, req.headers['x-bani-dikey'] as string | undefined);
  }

  @Get()
  myOrders(@CurrentUser() user: AuthUser, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.orders.myOrders(user.id, Number(skip) || 0, Number(take) || 20);
  }

  // Not: 'store/:storeId' rotası ':id'den ÖNCE tanımlı olmalı
  @RequirePermissions(Permission.ORDER_MANAGE)
  @Get('store/:storeId')
  storeOrders(@CurrentUser() user: AuthUser, @Param('storeId') storeId: string, @Query('status') status?: string) {
    return this.orders.storeOrders(user, storeId, status);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.getOne(user, id);
  }

  // Audit controller katmanında (kural 7: tek kaynak, serviste ikinci kayıt YOK).
  // Kayıt yalnızca servis başarıyla dönerse yazılır — reddedilen (Conflict/Forbidden)
  // geçişler audit'e girmez.
  @RequirePermissions(Permission.ORDER_MANAGE)
  @Patch(':id/status')
  async updateStatus(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateOrderStatusDto, @Req() req: Request) {
    const r = await this.orders.updateStatus(user, id, dto.status);
    await this.audit.record({ actorId: user.id, action: 'order.status.update', entity: 'Order', entityId: id, ip: req.ip, metadata: { to: dto.status } });
    return r;
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    const r = await this.orders.cancel(user, id);
    await this.audit.record({ actorId: user.id, action: 'order.cancel', entity: 'Order', entityId: id, ip: req.ip });
    return r;
  }
}
