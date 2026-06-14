import { PrismaClient, Role, WalletType, Currency, UserStatus, StoreType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // --- SUPER_ADMIN ---
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

  // --- Örnek satıcı ---
  const merchant = await prisma.user.upsert({
    where: { phone: '+905111111111' },
    update: {},
    create: {
      phone: '+905111111111',
      phoneVerified: true,
      name: 'Demo',
      surname: 'Market',
      roles: [Role.MERCHANT],
      status: UserStatus.ACTIVE,
    },
  });

  // --- Örnek mağaza ---
  const store = await prisma.store.upsert({
    where: { slug: 'demo-market' },
    update: {},
    create: {
      ownerId: merchant.id,
      name: 'Demo Market',
      slug: 'demo-market',
      type: StoreType.MARKET,
      city: 'Mersin',
      isActive: true,
    },
  });

  // --- Örnek kategori ---
  const category = await prisma.category.upsert({
    where: { storeId_slug: { storeId: store.id, slug: 'icecekler' } },
    update: {},
    create: { storeId: store.id, name: 'İçecekler', slug: 'icecekler' },
  });

  // --- Örnek ürünler ---
  const products = [
    { slug: 'su-05l', name: 'Su 0.5L', price: 750n },
    { slug: 'ayran-300ml', name: 'Ayran 300ml', price: 1500n },
    { slug: 'kola-1l', name: 'Kola 1L', price: 4200n },
  ];
  for (const p of products) {
    await prisma.product.upsert({
      where: { storeId_slug: { storeId: store.id, slug: p.slug } },
      update: {},
      create: {
        storeId: store.id,
        categoryId: category.id,
        name: p.name,
        slug: p.slug,
        price: p.price,
        stock: 100,
      },
    });
  }

  console.log('Seed tamam.');
  console.log('  SUPER_ADMIN :', admin.phone);
  console.log('  MERCHANT    :', merchant.phone);
  console.log('  Mağaza      :', store.slug, '(id:', store.id + ')');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
