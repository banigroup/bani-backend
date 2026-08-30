import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { FinanceService } from './finance.service';
import { HoldingService } from '../holding/holding.service';
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
  constructor(
    private readonly finance: FinanceService,
    // Rapor govdesi HoldingService'e tasindi (Faz 0 / paket 2); rota, izin ve
    // yanit ayni kaldi. Bkz. src/holding/holding.service.ts basligi.
    private readonly holding: HoldingService,
  ) { }

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
  // Yetki TEK YERDE: FINANCE_REPORT_READ (ADMIN + SUPER_ADMIN).
  // Onceden uc FINANCE_READ istiyordu; o izin ADMIN'de olmadigi icin asagidaki
  // "ADMIN da gecsin" kontrolune sira hic gelmiyordu - guard once kesiyordu.
  // Yorum "admin/super admin" diyor, davranis "yalniz super admin" idi. Rapora
  // ozel izin ayrildi: FINANCE_READ /superadmin'i de actigi icin oraya
  // dokunulmadi. Govdedeki olu rol kontrolu kaldirildi.
  @RequirePermissions(Permission.FINANCE_REPORT_READ)
  @Get('report/business-units')
  businessUnitReport(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const parse = (s?: string) => {
      if (!s) return undefined;
      const d = new Date(s);
      return isNaN(d.getTime()) ? undefined : d;
    };
    return this.holding.dikeyPnl(parse(from), parse(to));
  }
}

