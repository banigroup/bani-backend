import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EntryDirection, BusinessUnit, TransactionType, WalletType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { LedgerService } from './services/ledger.service';
import { WalletService } from './services/wallet.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment/payment-provider.interface';
import { TopupDto } from './dto/topup.dto';
import { TopupBaslatDto, TopupDogrulaDto } from './dto/topup-odeme.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { TransferDto } from './dto/transfer.dto';
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly payment: PaymentProvider,
  ) { }
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
      businessUnit: BusinessUnit.PLATFORM,
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
  // ADIM 1/2 — odemeyi baslat. Bu asamada HICBIR defter kaydi olusmaz; para
  // hareketi yalnizca dogrulanmis tahsilat sonrasinda yazilir.
  async topupBaslat(userId: string, dto: TopupBaslatDto, ip?: string) {
    const sonuc = await this.payment.initiate({
      userId,
      tutarKurus: BigInt(dto.tutarKurus),
      aciklama: dto.aciklama,
    });
    await this.audit.record({
      actorId: userId, action: 'finance.topup.baslat', entity: 'Payment', entityId: sonuc.saglayiciRef, ip,
      metadata: { tutarKurus: dto.tutarKurus, durum: sonuc.durum },
    });
    return sonuc;
  }

  // ADIM 2/2 — saglayicidan tahsilati dogrula, ancak basariliysa deftere yaz.
  // reference = saglayicinin referansi (istemci degil): ledger'in idempotency
  // kontrolu boylece istemcinin erisemeyecegi bir anahtara dayanir.
  // Tutar da saglayicinin onayladigi tutardir; istemci beyani kullanilmaz.
  async topupDogrula(userId: string, dto: TopupDogrulaDto, ip?: string) {
    const dogrulama = await this.payment.verify({
      saglayiciRef: dto.saglayiciRef,
      userId,
      saglayiciYaniti: dto.saglayiciYaniti,
    });
    if (!dogrulama.basarili) {
      await this.audit.record({
        actorId: userId, action: 'finance.topup.reddedildi', entity: 'Payment', entityId: dto.saglayiciRef, ip,
        metadata: { hataKodu: dogrulama.hataKodu ?? null },
      });
      throw new BadRequestException(dogrulama.hataMesaji ?? 'Odeme dogrulanamadi');
    }
    if (dogrulama.tahsilEdilenKurus <= 0n) {
      throw new BadRequestException('Saglayici sifir tutar bildirdi');
    }
    const userWallet = await this.wallets.getOrCreateUserWallet(userId);
    const platform = await this.wallets.getSystemWallet(WalletType.PLATFORM);
    const trx = await this.ledger.post({
      type: TransactionType.TOPUP,
      businessUnit: BusinessUnit.PLATFORM,
      reference: dogrulama.saglayiciRef,
      description: 'Bakiye yukleme (odeme saglayici)',
      lines: [
        { walletId: userWallet.id, direction: EntryDirection.CREDIT, amount: dogrulama.tahsilEdilenKurus },
        { walletId: platform.id, direction: EntryDirection.DEBIT, amount: dogrulama.tahsilEdilenKurus },
      ],
    });
    await this.audit.record({
      actorId: userId, action: 'finance.topup.dogrulandi', entity: 'Transaction', entityId: trx.id, ip,
      metadata: { saglayiciRef: dogrulama.saglayiciRef, tutarKurus: dogrulama.tahsilEdilenKurus.toString() },
    });
    return trx;
  }

  async withdraw(userId: string, dto: WithdrawDto, ip?: string) {
    const userWallet = await this.wallets.getOrCreateUserWallet(userId);
    const platform = await this.wallets.getSystemWallet(WalletType.PLATFORM);
    const amount = BigInt(dto.amount);
    const trx = await this.ledger.post({
      type: TransactionType.WITHDRAWAL,
      businessUnit: BusinessUnit.PLATFORM,
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
      businessUnit: BusinessUnit.PLATFORM,
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
