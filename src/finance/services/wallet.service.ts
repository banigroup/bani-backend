import { Injectable } from '@nestjs/common';
import { Currency, WalletType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateUserWallet(userId: string, currency: Currency = Currency.TRY) {
    return this.prisma.wallet.upsert({
      where: { userId_type_currency: { userId, type: WalletType.USER, currency } },
      update: {},
      create: { userId, type: WalletType.USER, currency },
    });
  }

  async getSystemWallet(type: WalletType, currency: Currency = Currency.TRY) {
    const existing = await this.prisma.wallet.findFirst({ where: { type, currency } });
    if (existing) return existing;
    return this.prisma.wallet.create({ data: { type, currency } });
  }
}
