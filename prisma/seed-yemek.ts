import { PrismaClient, StoreType, BusinessUnit } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    let owner = await prisma.user.findUnique({ where: { phone: '+905111111111' } });
    if (!owner) {
        const market = await prisma.store.findUnique({ where: { slug: 'demo-market' } });
        if (!market) throw new Error('Önce ana seed çalışmalı.');
        owner = await prisma.user.findUnique({ where: { id: market.ownerId } });
    }
    if (!owner) throw new Error('Mağaza sahibi bulunamadı.');

    const store = await prisma.store.upsert({
        where: { slug: 'demo-yemek' },
        update: {},
        create: {
            ownerId: owner.id,
            name: 'Bani Yemek — Demo Restoran',
            slug: 'demo-yemek',
            type: StoreType.RESTAURANT,
            businessUnit: BusinessUnit.YEMEK,
            city: 'Diyarbakır',
            isActive: true,
        },
    });

    const menu: { slug: string; name: string; unit: string; items: { slug: string; name: string; price: bigint }[] }[] = [
        {
            slug: 'corbalar', name: 'Çorbalar', unit: 'kase', items: [
                { slug: 'mercimek-corbasi', name: 'Mercimek Çorbası', price: 5500n },
                { slug: 'ezogelin-corbasi', name: 'Ezogelin Çorbası', price: 5500n },
                { slug: 'iskembe-corbasi', name: 'İşkembe Çorbası', price: 7000n },
                { slug: 'yayla-corbasi', name: 'Yayla Çorbası', price: 5500n },
            ],
        },
        {
            slug: 'kebaplar', name: 'Kebaplar', unit: 'porsiyon', items: [
                { slug: 'adana-kebap', name: 'Adana Kebap', price: 18000n },
                { slug: 'urfa-kebap', name: 'Urfa Kebap', price: 18000n },
                { slug: 'tavuk-sis', name: 'Tavuk Şiş', price: 15000n },
                { slug: 'kuzu-sis', name: 'Kuzu Şiş', price: 22000n },
                { slug: 'ciger-sis', name: 'Ciğer Şiş', price: 16000n },
                { slug: 'beyti', name: 'Beyti Sarma', price: 24000n },
                { slug: 'icli-kofte', name: 'İçli Köfte (3\'lü)', price: 9000n },
            ],
        },
        {
            slug: 'pide-lahmacun', name: 'Pide & Lahmacun', unit: 'adet', items: [
                { slug: 'lahmacun', name: 'Lahmacun', price: 4000n },
                { slug: 'kiymali-pide', name: 'Kıymalı Pide', price: 12000n },
                { slug: 'kasarli-pide', name: 'Kaşarlı Pide', price: 13000n },
                { slug: 'kusbasili-pide', name: 'Kuşbaşılı Pide', price: 15000n },
                { slug: 'karisik-pide', name: 'Karışık Pide', price: 16000n },
            ],
        },
        {
            slug: 'durumler', name: 'Dürümler', unit: 'adet', items: [
                { slug: 'adana-durum', name: 'Adana Dürüm', price: 9000n },
                { slug: 'tavuk-durum', name: 'Tavuk Dürüm', price: 8000n },
                { slug: 'ciger-durum', name: 'Ciğer Dürüm', price: 8500n },
                { slug: 'kuzu-durum', name: 'Kuzu Dürüm', price: 11000n },
            ],
        },
        {
            slug: 'tatlilar', name: 'Tatlılar', unit: 'porsiyon', items: [
                { slug: 'kunefe', name: 'Künefe', price: 11000n },
                { slug: 'baklava', name: 'Baklava (4\'lü)', price: 12000n },
                { slug: 'sutlac', name: 'Fırın Sütlaç', price: 6000n },
                { slug: 'kadayif', name: 'Kadayıf', price: 9000n },
            ],
        },
        {
            slug: 'icecekler', name: 'İçecekler', unit: 'adet', items: [
                { slug: 'ayran', name: 'Ayran', price: 2000n },
                { slug: 'salgam', name: 'Şalgam Suyu', price: 2500n },
                { slug: 'kola', name: 'Kola', price: 2500n },
                { slug: 'cay', name: 'Çay', price: 1500n },
                { slug: 'sira', name: 'Şıra', price: 3000n },
            ],
        },
    ];

    let count = 0;
    for (const c of menu) {
        const category = await prisma.category.upsert({
            where: { storeId_slug: { storeId: store.id, slug: c.slug } },
            update: {},
            create: { storeId: store.id, name: c.name, slug: c.slug },
        });
        for (const it of c.items) {
            await prisma.product.upsert({
                where: { storeId_slug: { storeId: store.id, slug: it.slug } },
                update: { name: it.name, price: it.price },
                create: { storeId: store.id, categoryId: category.id, name: it.name, slug: it.slug, price: it.price, stock: 100, unit: c.unit },
            });
            count++;
        }
    }

    console.log('Bani Yemek seed tamam. Restoran:', store.slug, '| Kategori:', menu.length, '| Urun:', count);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
