import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { FinanceService } from './finance.service';
import { TopupDto } from './dto/topup.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { TransferDto } from './dto/transfer.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@Controller('finance')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

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
}