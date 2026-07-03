import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp/otp.service';
import { TokenService } from './tokens/token.service';

interface ReqMeta { ip?: string; userAgent?: string }

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
  ) { }

  async requestOtp(phone: string) {
    const code = await this.otp.issue(phone);
    const devCode = (process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_CODE === 'true') ? code : undefined;
    return { sent: true, devCode };
  }

  async verifyOtp(phone: string, code: string, meta: ReqMeta) {
    await this.otp.verify(phone, code);
    const user = await this.prisma.user.upsert({
      where: { phone },
      update: { phoneVerified: true, status: UserStatus.ACTIVE },
      create: { phone, phoneVerified: true, status: UserStatus.ACTIVE },
    });
    const accessToken = this.tokens.signAccess({ sub: user.id, phone: user.phone, roles: user.roles });
    const refreshToken = await this.tokens.issueRefresh(user.id, meta);
    return { accessToken, refreshToken, user: { id: user.id, phone: user.phone, roles: user.roles, status: user.status } };
  }

  // Misafir oturumu: anonim bir kullanici acar ve token verir (login YOK).
  // Sepet + checkout + escrow akisinin aynen calismasi icin gercek bir kullanici satiri gerekir.
  async guestSession(meta: ReqMeta) {
    const user = await this.prisma.user.create({
      data: {
        phone: `guest_${randomUUID()}`,
        phoneVerified: false,
        status: UserStatus.ACTIVE,
      },
    });
    const accessToken = this.tokens.signAccess({ sub: user.id, phone: user.phone, roles: user.roles });
    const refreshToken = await this.tokens.issueRefresh(user.id, meta);
    return { accessToken, refreshToken, guest: true, user: { id: user.id, phone: user.phone, roles: user.roles, status: user.status } };
  }

  async refresh(raw: string, meta: ReqMeta) {
    const rotated = await this.tokens.rotateRefresh(raw, meta);
    if (!rotated) return null;
    const { user, refreshToken } = rotated;
    const accessToken = this.tokens.signAccess({ sub: user.id, phone: user.phone, roles: user.roles });
    return { accessToken, refreshToken };
  }

  async logout(raw: string): Promise<{ ok: true }> {
    await this.tokens.revoke(raw);
    return { ok: true };
  }
}
