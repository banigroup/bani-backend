import { Body, Controller, Post, Req, UnauthorizedException, HttpCode } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshDto } from './dto/refresh.dto';

function meta(req: Request) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) { }

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
    return this.auth.verifyOtp(dto.phone, dto.code, meta(req));
  }

  @Post('guest-session')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  guestSession(@Req() req: Request) {
    return this.auth.guestSession(meta(req));
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    const result = await this.auth.refresh(dto.refreshToken, meta(req));
    if (!result) throw new UnauthorizedException('Gecersiz refresh token');
    return result;
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }
}
