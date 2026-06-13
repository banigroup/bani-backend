import { Injectable, NotFoundException } from '@nestjs/common';
import { EntryDirection, TransactionType, WalletType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { LedgerService } from './services/ledger.service';
import { WalletService } from './services/wallet.service';
import { TopupDto } from './dto/topup.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { TransferDto } from './dto/transfer.dto';

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletService,
    private readonly audit: AuditService,
  ) {}

  myWallet(userId: string) {
    return this.wallets.getOrCreateUserWallet(userId);
  }

  async transactions(userId: string, skip = 0, take = 50) {
    const wallet = await this.wallets.getOrCreateUserWallet(userId);
    return this.prisma.ledgerEntry.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Math.min(take, 100),
      include: { transaction: true },
    });
  }

  async topup(userId: string, dto: TopupDto, ip?: string) {
    const userWallet = await this.wallets.getOrCreateUserWallet(userId);
    const platform = await this.wallets.getSystemWallet(WalletType.PLATFORM);
    const amount = BigInt(dto.amount);
    const trx = await this.ledger.post({
      type: TransactionType.TOPUP,
      reference: dto.reference,
      description: dto.description ?? 'Bakiye yükleme',
      lines: [
        { walletId: userWallet.id, direction: EntryDirection.CREDIT, amount },
        { walletId: platform.id, direction: EntryDirection.DEBIT, amount },
      ],
    });
    await this.audit.record({ actorId: userId, action: 'finance.topup', entity: 'Transaction', entityId: trx.id, ip, metadata: { amount: dto.amount } });
    return trx;
  }

  async withdraw(userId: string, dto: WithdrawDto, ip?: string) {
    const userWallet = await this.wallets.getOrCreateUserWallet(userId);
    const platform = await this.wallets.getSystemWallet(WalletType.PLATFORM);
    const amount = BigInt(dto.amount);
    const trx = await this.ledger.post({
      type: TransactionType.WITHDRAWAL,
      reference: dto.reference,
      description: dto.description ?? 'Para çekme',
      lines: [
        { walletId: userWallet.id, direction: EntryDirection.DEBIT, amount },
        { walletId: platform.id, direction: EntryDirection.CREDIT, amount },
      ],
    });
    await this.audit.record({ actorId: userId, action: 'finance.withdraw', entity: 'Transaction', entityId: trx.id, ip, metadata: { amount: dto.amount } });
    return trx;
  }

  async transfer(fromUserId: string, dto: TransferDto, ip?: string) {
    const target = await this.prisma.user.findUnique({ where: { id: dto.toUserId } });
    if (!target) throw new NotFoundException('Alıcı bulunamadı');
    const fromWallet = await this.wallets.getOrCreateUserWallet(fromUserId);
    const toWallet = await this.wallets.getOrCreateUserWallet(dto.toUserId);
    const amount = BigInt(dto.amount);
    const trx = await this.ledger.post({
      type: TransactionType.TRANSFER,
      reference: dto.reference,
      description: dto.description ?? 'Transfer',
      lines: [
        { walletId: fromWallet.id, direction: EntryDirection.DEBIT, amount },
        { walletId: toWallet.id, direction: EntryDirection.CREDIT, amount },
      ],
    });
    await this.audit.record({ actorId: fromUserId, action: 'finance.transfer', entity: 'Transaction', entityId: trx.id, ip, metadata: { to: dto.toUserId, amount: dto.amount } });
    return trx;
  }
}