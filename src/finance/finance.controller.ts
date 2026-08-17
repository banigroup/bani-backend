import { Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { FinanceService } from './finance.service';
import { TopupDto } from './dto/topup.dto';
import { TopupBaslatDto, TopupDogrulaDto } from './dto/topup-odeme.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { TransferDto } from './dto/transfer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/rbac/permissions.guard';
import { RequirePermissions } from '../common/rbac/permissions.decorator';
import { Permission } from '../common/rbac/permissions.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller('finance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) { }

  @RequirePermissions(Permission.WALLET_READ)
  @Get('wallet')
  wallet(@CurrentUser() user: AuthUser) {
    return this.finance.myWallet(user.id);
  }

  @RequirePermissions(Permission.TRANSACTION_READ)
  @Get('transactions')
  transactions(@CurrentUser() user: AuthUser, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.finance.transactions(user.id, Number(skip) || 0, Number(take) || 50);
  }

  // MANUEL/YONETIM yolu: odeme saglayicisina danismadan bakiye yazar.
  // WALLET_TOPUP yalnizca SUPER_ADMIN'dedir - musteri akisi asagidaki iki adimdir.
  @RequirePermissions(Permission.WALLET_TOPUP)
  @Post('topup')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  topup(@CurrentUser() user: AuthUser, @Body() dto: TopupDto, @Req() req: Request) {
    return this.finance.topup(user.id, dto, req.ip);
  }

  // MUSTERI ODEME AKISI (iki adimli, 3DS'e hazir)
  @RequirePermissions(Permission.PAYMENT_INITIATE)
  @Post('topup/baslat')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  topupBaslat(@CurrentUser() user: AuthUser, @Body() dto: TopupBaslatDto, @Req() req: Request) {
    return this.finance.topupBaslat(user.id, dto, req.ip);
  }

  @RequirePermissions(Permission.PAYMENT_INITIATE)
  @Post('topup/dogrula')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  topupDogrula(@CurrentUser() user: AuthUser, @Body() dto: TopupDogrulaDto, @Req() req: Request) {
    return this.finance.topupDogrula(user.id, dto, req.ip);
  }

  @RequirePermissions(Permission.WALLET_WITHDRAW)
  @Post('withdraw')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  withdraw(@CurrentUser() user: AuthUser, @Body() dto: WithdrawDto, @Req() req: Request) {
    return this.finance.withdraw(user.id, dto, req.ip);
  }

  @RequirePermissions(Permission.WALLET_WITHDRAW)
  @Post('transfer')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  transfer(@CurrentUser() user: AuthUser, @Body() dto: TransferDto, @Req() req: Request) {
    return this.finance.transfer(user.id, dto, req.ip);
  }

  // Dikey bazlı P&L raporu (admin/süper admin) — admin panelinden çağrılır.
  // İsteğe bağlı tarih filtresi: ?from=2026-06-01&to=2026-06-30
  @RequirePermissions(Permission.FINANCE_READ)
  @Get('report/business-units')
  businessUnitReport(
    @CurrentUser() user: AuthUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const roles = user.roles ?? [];
    if (!roles.includes(Role.SUPER_ADMIN) && !roles.includes(Role.ADMIN)) {
      throw new ForbiddenException('Bu rapor için admin yetkisi gerekli');
    }
    const parse = (s?: string) => {
      if (!s) return undefined;
      const d = new Date(s);
      return isNaN(d.getTime()) ? undefined : d;
    };
    return this.finance.businessUnitReport(parse(from), parse(to));
  }
}

