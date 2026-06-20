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

  // --- Örnek kurye (Faz 4) ---
  const courier = await prisma.user.upsert({
    where: { phone: '+905222222222' },
    update: { roles: [Role.COURIER] },
    create: {
      phone: '+905222222222',
      phoneVerified: true,
      name: 'Demo',
      surname: 'Kurye',
      roles: [Role.COURIER],
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

  // --- Zengin katalog: kategoriler + ürünler ---
  const catalog: { slug: string; name: string; products: { slug: string; name: string; price: bigint }[] }[] = [
    {
      slug: 'icecekler', name: 'İçecekler', products: [
        { slug: 'su-05l', name: 'Su 0.5L', price: 750n },
        { slug: 'su-5l', name: 'Su 5L', price: 2900n },
        { slug: 'ayran-300ml', name: 'Ayran 300ml', price: 1500n },
        { slug: 'kola-1l', name: 'Kola 1L', price: 4200n },
        { slug: 'kola-330ml', name: 'Kola 330ml', price: 2500n },
        { slug: 'maden-suyu-200ml', name: 'Maden Suyu 200ml', price: 1200n },
        { slug: 'portakal-suyu-1l', name: 'Portakal Suyu 1L', price: 4500n },
        { slug: 'cay-500g', name: 'Çay 500g', price: 8500n },
        { slug: 'soda-6li', name: 'Soda 6\'lı', price: 3600n },
      ],
    },
    {
      slug: 'sut-kahvaltilik', name: 'Süt & Kahvaltılık', products: [
        { slug: 'sut-1l', name: 'Süt 1L', price: 3200n },
        { slug: 'yumurta-10lu', name: 'Yumurta 10\'lu', price: 5500n },
        { slug: 'beyaz-peynir-500g', name: 'Beyaz Peynir 500g', price: 9500n },
        { slug: 'kasar-400g', name: 'Kaşar Peyniri 400g', price: 11000n },
        { slug: 'tereyagi-250g', name: 'Tereyağı 250g', price: 7800n },
        { slug: 'bal-850g', name: 'Süzme Bal 850g', price: 18000n },
        { slug: 'zeytin-500g', name: 'Siyah Zeytin 500g', price: 8000n },
        { slug: 'recel-380g', name: 'Vişne Reçeli 380g', price: 5200n },
      ],
    },
    {
      slug: 'temel-gida', name: 'Temel Gıda', products: [
        { slug: 'ekmek', name: 'Ekmek', price: 1000n },
        { slug: 'pirinc-1kg', name: 'Pirinç 1kg', price: 6500n },
        { slug: 'makarna-500g', name: 'Makarna 500g', price: 1800n },
        { slug: 'un-1kg', name: 'Un 1kg', price: 2400n },
        { slug: 'seker-1kg', name: 'Toz Şeker 1kg', price: 3500n },
        { slug: 'aycicek-yagi-1l', name: 'Ayçiçek Yağı 1L', price: 7500n },
        { slug: 'salca-700g', name: 'Domates Salçası 700g', price: 4800n },
        { slug: 'mercimek-1kg', name: 'Kırmızı Mercimek 1kg', price: 5500n },
      ],
    },
    {
      slug: 'atistirmalik', name: 'Atıştırmalık & Tatlı', products: [
        { slug: 'cips-110g', name: 'Cips 110g', price: 3200n },
        { slug: 'biskuvi-200g', name: 'Bisküvi 200g', price: 2200n },
        { slug: 'cikolata-80g', name: 'Çikolata 80g', price: 2800n },
        { slug: 'kuruyemis-200g', name: 'Karışık Kuruyemiş 200g', price: 7000n },
        { slug: 'gofret', name: 'Gofret', price: 1500n },
      ],
    },
    {
      slug: 'temizlik', name: 'Temizlik & Kağıt', products: [
        { slug: 'bulasik-deterjani', name: 'Bulaşık Deterjanı 750ml', price: 4500n },
        { slug: 'camasir-suyu-1l', name: 'Çamaşır Suyu 1L', price: 2800n },
        { slug: 'kagit-havlu-2li', name: 'Kağıt Havlu 2\'li', price: 3800n },
        { slug: 'tuvalet-kagidi-8li', name: 'Tuvalet Kağıdı 8\'li', price: 6500n },
        { slug: 'sivi-sabun-500ml', name: 'Sıvı Sabun 500ml', price: 3500n },
      ],
    },
    {
      slug: 'manav', name: 'Meyve & Sebze', products: [
        { slug: 'domates-1kg', name: 'Domates 1kg', price: 3000n },
        { slug: 'salatalik-1kg', name: 'Salatalık 1kg', price: 2800n },
        { slug: 'elma-1kg', name: 'Elma 1kg', price: 3500n },
        { slug: 'muz-1kg', name: 'Muz 1kg', price: 5500n },
        { slug: 'patates-2kg', name: 'Patates 2kg', price: 4000n },
        { slug: 'sogan-1kg', name: 'Kuru Soğan 1kg', price: 2200n },
        { slug: 'limon-1kg', name: 'Limon 1kg', price: 4000n },
      ],
    },
  ];

  let productCount = 0;
  for (const c of catalog) {
    const category = await prisma.category.upsert({
      where: { storeId_slug: { storeId: store.id, slug: c.slug } },
      update: {},
      create: { storeId: store.id, name: c.name, slug: c.slug },
    });
    for (const p of c.products) {
      await prisma.product.upsert({
        where: { storeId_slug: { storeId: store.id, slug: p.slug } },
        update: { name: p.name, price: p.price },
        create: {
          storeId: store.id,
          categoryId: category.id,
          name: p.name,
          slug: p.slug,
          price: p.price,
          stock: 100,
        },
      });
      productCount++;
    }
  }

  console.log('Seed tamam.');
  console.log('  SUPER_ADMIN :', admin.phone);
  console.log('  MERCHANT    :', merchant.phone);
  console.log('  COURIER     :', courier.phone);
  console.log('  Mağaza      :', store.slug, '(id:', store.id + ')');
  console.log('  Kategori    :', catalog.length);
  console.log('  Ürün        :', productCount);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
