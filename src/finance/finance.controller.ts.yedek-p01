import { Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Role } from '@prisma/client';
import { FinanceService } from './finance.service';
import { TopupDto } from './dto/topup.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { TransferDto } from './dto/transfer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller('finance')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) { }

  @Get('wallet')
  wallet(@CurrentUser() user: AuthUser) {
    return this.finance.myWallet(user.id);
  }

  @Get('transactions')
  transactions(@CurrentUser() user: AuthUser, @Query('skip') skip?: string, @Query('take') take?: string) {
    return this.finance.transactions(user.id, Number(skip) || 0, Number(take) || 50);
  }

  @Post('topup')
  topup(@CurrentUser() user: AuthUser, @Body() dto: TopupDto, @Req() req: Request) {
    return this.finance.topup(user.id, dto, req.ip);
  }

  @Post('withdraw')
  withdraw(@CurrentUser() user: AuthUser, @Body() dto: WithdrawDto, @Req() req: Request) {
    return this.finance.withdraw(user.id, dto, req.ip);
  }

  @Post('transfer')
  transfer(@CurrentUser() user: AuthUser, @Body() dto: TransferDto, @Req() req: Request) {
    return this.finance.transfer(user.id, dto, req.ip);
  }

  // Dikey bazlı P&L raporu (admin/süper admin) — admin panelinden çağrılır.
  // İsteğe bağlı tarih filtresi: ?from=2026-06-01&to=2026-06-30
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
