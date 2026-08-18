import { Body, Controller, Post, Req, UnauthorizedException, HttpCode, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshDto } from './dto/refresh.dto';
import { TransferCodeUretDto, TransferCodeTuketDto } from './dto/transfer-code.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../common/audit/audit.service';

function meta(req: Request) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly audit: AuditService) { }

  @Post('otp/request')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post('otp/verify')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    return this.auth.verifyOtp(dto.phone, dto.code, meta(req), dto.roller);
  }

  @Post('guest-session')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  guestSession(@Req() req: Request) {
    return this.auth.guestSession(meta(req));
  }

  @Post('refresh')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    const result = await this.auth.refresh(dto.refreshToken, meta(req));
    if (!result) throw new UnauthorizedException('Gecersiz refresh token');
    return result;
  }

  // KAYNAK taraf: oturum sahibi hedef domain icin bilet alir (guard'li).
  @Post('transfer-code')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async transferCodeUret(@CurrentUser() user: AuthUser, @Body() dto: TransferCodeUretDto, @Req() req: Request) {
    const r = await this.auth.transferKoduUret(user.id, dto.hedefOrigin, meta(req));
    await this.audit.record({
      actorId: user.id, action: 'auth.transferCode.uret', entity: 'TransferCode', ip: req.ip,
      metadata: { hedefOrigin: dto.hedefOrigin },
    });
    return r;
  }

  // HEDEF taraf: YETKI YOK - kimlik kaniti kodun kendisidir. Kod 60 sn omurlu,
  // tek kullanimlik ve yalnizca uretildigi origin'de gecerlidir.
  @Public()
  @Post('transfer-code/consume')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async transferCodeTuket(@Body() dto: TransferCodeTuketDto, @Req() req: Request) {
    const r = await this.auth.transferKoduTuket(dto.kod, req.headers.origin, dto.mevcutToken, meta(req));
    if (!r) {
      // Gecersiz / suresi dolmus / kullanilmis / origin uyusmaz: hepsi AYNI yanit.
      // Ayrim yapmak kod tahminine bilgi sizdirir. Istemci zaten sessizce devirsiz devam eder.
      throw new UnauthorizedException('Devir kodu gecersiz');
    }
    await this.audit.record({
      actorId: 'sepetCakismasi' in r ? null : r.user.id,
      action: 'sepetCakismasi' in r ? 'auth.transferCode.sepetCakismasi' : 'auth.transferCode.tuket',
      entity: 'TransferCode', ip: req.ip,
    });
    return r;
  }

  @Post('logout')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @HttpCode(200)
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }
}

