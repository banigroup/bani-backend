import { PrismaClient, Role, WalletType, Currency, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.user.upsert({
    where: { phone: '+905000000000' },
    update: {},
    create: {
      phone: '+905000000000',
      phoneVerified: true,
      name: 'Platform',
      surname: 'Admin',
      roles: [Role.SUPER_ADMIN],
      status: UserStatus.ACTIVE,
    },
  });

  await prisma.wallet.upsert({
    where: { userId_type_currency: { userId: admin.id, type: WalletType.PLATFORM, currency: Currency.TRY } },
    update: {},
    create: { userId: admin.id, type: WalletType.PLATFORM, currency: Currency.TRY },
  });

  console.log('Seed tamam. SUPER_ADMIN:', admin.phone);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
