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

  // ---------------- CROSS-DOMAIN OTURUM DEVRI ----------------
  // Kod URL'de tasinir, o yuzden omru KISA (60 sn) ve tek kullanimliktir.
  // Uzun omurlu sir (refresh token) URL'e ASLA konmaz; kod tuketilince
  // hedef domain icin taze access+refresh uretilir.
  private readonly TRANSFER_TTL_SN = 60;

  async issueTransferCode(
    userId: string,
    hedefOrigin: string,
    meta?: { ip?: string; userAgent?: string },
  ): Promise<{ kod: string; sonKullanma: Date }> {
    const raw = randomBytes(32).toString('hex');
    const sonKullanma = new Date(Date.now() + this.TRANSFER_TTL_SN * 1000);
    await this.prisma.transferCode.create({
      data: {
        userId,
        kodHash: this.hash(raw), // RefreshToken/OtpRequest ile ayni: ham deger saklanmaz
        hedefOrigin: this.originNormalize(hedefOrigin),
        expiresAt: sonKullanma,
        ip: meta?.ip,
        cihaz: meta?.userAgent,
      },
    });
    return { kod: raw, sonKullanma };
  }

  /** www farkini ve sondaki '/' isaretini siler; kucuk harfe indirir. */
  private originNormalize(origin: string): string {
    return origin.trim().toLowerCase().replace(/\/+$/, '').replace('://www.', '://');
  }

  // Tuketim ATOMIK: damgalama updateMany + count ile yapilir, boylece ayni kod
  // es zamanli iki istekte iki kez kullanilamaz (kosullu yazim, okuma degil).
  async consumeTransferCode(kod: string, istekOrigin?: string) {
    const kayit = await this.prisma.transferCode.findUnique({
      where: { kodHash: this.hash(kod) },
      include: { user: true },
    });
    if (!kayit) return null;
    if (kayit.consumedAt || kayit.expiresAt < new Date()) return null;
    // Origin baglama: kod yalnizca uretildigi hedef icin gecerlidir. Tarayici
    // cross-origin POST'ta Origin basligini her zaman gonderir; gondermeyen
    // istemci bu akisin hedefi degildir.
    if (!istekOrigin) return null;
    if (this.originNormalize(istekOrigin) !== kayit.hedefOrigin) return null;

    const kilit = await this.prisma.transferCode.updateMany({
      where: { id: kayit.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (kilit.count !== 1) return null; // yaris: baska bir istek tuketti
    return kayit.user;
  }

  /** mevcutToken dogrulamasi (sepet cakismasi kontrolu icin). Gecersizse null. */
  verifyAccess(token: string): AccessPayload | null {
    try {
      return this.jwt.verify<AccessPayload>(token, {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
    } catch {
      return null;
    }
  }

  async revoke(raw: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hash(raw), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
