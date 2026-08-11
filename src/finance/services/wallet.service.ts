import { Injectable } from '@nestjs/common';
import { Currency, Wallet, WalletType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// Sistem cuzdani tipleri. Bu liste, kismi unique index
// "wallets_sistem_tip_para_key" (migration 20260811083500) icindeki
// WHERE kosuluyla AYNI kalmali - biri degisirse digeri de degismeli.
const SISTEM_TIPLERI: WalletType[] = [WalletType.PLATFORM, WalletType.ESCROW];

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

  // Sistem cuzdani (PLATFORM / ESCROW): type + currency ile TEKtir.
  // Eskiden findFirst + create idi: ikisi arasinda yaris vardi ve cuzdan userId NULL
  // yaratildigi icin @@unique([userId, type, currency]) devreye girmiyordu (Postgres'te
  // NULL != NULL) - iki es zamanli istek iki ayri ESCROW cuzdani dogurabiliyordu.
  // Artik tekillik DB'de kismi unique index ile garanti; burada ON CONFLICT DO NOTHING
  // ile atomik get-or-create yapiliyor. userId'ye BAKILMAZ: canlida PLATFORM cuzdaninin
  // userId'si seed'den dolu, ESCROW'unki NULL; ikisi de ayni sekilde bulunur.
  async getSystemWallet(type: WalletType, currency: Currency = Currency.TRY): Promise<Wallet> {
    if (!SISTEM_TIPLERI.includes(type)) {
      throw new Error(`getSystemWallet yalnizca sistem cuzdani icindir (${SISTEM_TIPLERI.join(' / ')}); gelen: ${type}`);
    }
    const bul = async (): Promise<Wallet | undefined> => {
      const kayitlar = await this.prisma.$queryRaw<Wallet[]>`
        SELECT * FROM "wallets"
        WHERE "type" = ${type}::"WalletType" AND "currency" = ${currency}::"Currency"
        LIMIT 1`;
      return kayitlar[0];
    };
    const mevcut = await bul();
    if (mevcut) return mevcut; // sicak yol: salt okuma, yazma yok
    // Yaris: iki istek ayni anda gelirse biri yazar, digeri catisip hicbir sey yapmaz.
    await this.prisma.$executeRaw`
      INSERT INTO "wallets" ("id", "type", "currency", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${type}::"WalletType", ${currency}::"Currency", now(), now())
      ON CONFLICT ("type", "currency") WHERE "type" IN ('PLATFORM', 'ESCROW') DO NOTHING`;
    const olusan = await bul();
    if (!olusan) throw new Error(`Sistem cuzdani olusturulamadi: ${type}/${currency}`);
    return olusan;
  }
}
