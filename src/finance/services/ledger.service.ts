import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import {
  Prisma, EntryDirection, TransactionType, TransactionStatus,
  BusinessUnit, Currency, WalletType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface PostingLine {
  walletId: string;
  direction: EntryDirection;
  amount: bigint;
}

export interface PostingInput {
  type: TransactionType;
  currency?: Currency;
  reference?: string;
  description?: string;
  businessUnit: BusinessUnit;
  commission?: bigint;
  vat?: bigint;
  deliveryFee?: bigint;
  netRevenue?: bigint;
  orderNo?: string;
  metadata?: Prisma.InputJsonValue;
  lines: PostingLine[];
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  // Kendi transaction'ını açar (tek başına çağrı için).
  async post(input: PostingInput) {
    return this.prisma.$transaction((tx) => this.postWithTx(tx, input));
  }

  // Dışarıdan verilen bir transaction client (tx) içinde çalışır.
  // Sipariş gibi çok adımlı işlemlerde atomik (hepsi-ya-hiç) kullanım için.
  async postWithTx(tx: Prisma.TransactionClient, input: PostingInput) {
    if (input.lines.length < 2) {
      throw new BadRequestException('Bir kayıt en az iki satır içermeli');
    }

    let debit = 0n;
    let credit = 0n;
    for (const l of input.lines) {
      if (l.amount <= 0n) throw new BadRequestException('Satır tutarı pozitif olmalı');
      if (l.direction === EntryDirection.DEBIT) debit += l.amount;
      else credit += l.amount;
    }
    if (debit !== credit) {
      throw new BadRequestException('Borç ve alacak dengelenmedi');
    }

    if (input.reference) {
      const existing = await tx.transaction.findUnique({ where: { reference: input.reference } });
      if (existing) return existing; // idempotent — aynı referans ikinci kez işlenmez
    }

    const trx = await tx.transaction.create({
      data: {
        type: input.type,
        status: TransactionStatus.COMPLETED,
        currency: input.currency ?? Currency.TRY,
        amount: credit,
        reference: input.reference,
        description: input.description,
        businessUnit: input.businessUnit,
        orderNo: input.orderNo,
        commission: input.commission ?? 0n,
        vat: input.vat ?? 0n,
        deliveryFee: input.deliveryFee ?? 0n,
        netRevenue: input.netRevenue ?? 0n,
        metadata: input.metadata,
      },
    });

    for (const line of input.lines) {
      const wallet = await tx.wallet.findUnique({ where: { id: line.walletId } });
      if (!wallet) throw new BadRequestException('Cüzdan bulunamadı');

      const delta = line.direction === EntryDirection.CREDIT ? line.amount : -line.amount;
      const newBalance = wallet.balance + delta;

      if (newBalance < 0n && (wallet.type === WalletType.USER || wallet.type === WalletType.MERCHANT)) {
        throw new ConflictException('Yetersiz bakiye');
      }

      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });
      await tx.ledgerEntry.create({
        data: {
          transactionId: trx.id,
          walletId: wallet.id,
          direction: line.direction,
          amount: line.amount,
          balanceAfter: newBalance,
        },
      });
    }

    return trx;
  }
}
