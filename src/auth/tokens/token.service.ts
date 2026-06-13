import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AccessPayload {
  sub: string;
  phone: string;
  roles: Role[];
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  signAccess(payload: AccessPayload): string {
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>('jwt.accessTtl'),
    });
  }

  async issueRefresh(userId: string, meta?: { ip?: string; userAgent?: string }): Promise<string> {
    const raw = randomBytes(48).toString('hex');
    const days = this.config.get<number>('jwt.refreshTtlDays', 30);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hash(raw),
        expiresAt: new Date(Date.now() + days * 86_400_000),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      },
    });
    return raw;
  }

  async rotateRefresh(raw: string, meta?: { ip?: string; userAgent?: string }) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(raw) },
      include: { user: true },
    });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      return null;
    }
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
    const newRefresh = await this.issueRefresh(record.userId, meta);
    return { user: record.user, refreshToken: newRefresh };
  }

  async revoke(raw: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
