// FAZ 3 / ADIM 3 — SECENEKLERIN SEPETE VE SIPARIS SATIRINA TASINMASI
// Calistir: npm run build && node test-secenek.js
//
// GERCEK KODU calistirir (dist/): CartService.addItem ve OrdersService.checkout
// kopyalanmaz, ice aktarilir. Ayni mantigin ikinci bir kopyasi yazilsaydi test
// kendi kopyasini dogrulamis olurdu.
//
// YALNIZCA YEREL DOCKER DB: asagidaki kapi localhost disinda calismayi reddeder.
// Test verisi benzersiz onekle yaratilir ve sonunda TAMAMEN silinir.
const fs = require('fs');
const path = require('path');
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  env.split('\n').forEach((line) => {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* .env yoksa ortam degiskeni beklenir */ }

// --- GUVENLIK KAPISI: yalnizca yerel DB ---
const u = new URL(process.env.DATABASE_URL || 'postgres://yok/yok');
if (!['localhost', '127.0.0.1'].includes(u.hostname)) {
  console.error(`REDDEDILDI: bu betik yalnizca yerel DB'de calisir. Hedef: ${u.hostname}:${u.port}`);
  process.exit(1);
}
console.log(`DB: ${u.hostname}:${u.port}${u.pathname}\n`);

const { PrismaClient } = require('@prisma/client');
const { CartService } = require('./dist/src/cart/cart.service');
const { OrdersService } = require('./dist/src/orders/orders.service');
const { LedgerService } = require('./dist/src/finance/services/ledger.service');
const { WalletService } = require('./dist/src/finance/services/wallet.service');
const { OrderStatusService } = require('./dist/src/orders/order-status.service');
const { MarketService } = require('./dist/src/market/market.service');
const { vitrinFiyatHesapla, ekUcretHesapla } = require('./dist/src/delivery/pricing');

const prisma = new PrismaClient();
const cart = new CartService(prisma);
// checkout'un kullandigi bagimliliklar GERCEK; kullanmadiklari (audit, satici
// durumu, SMS) yerine bos vekil verildi - checkout yolunda cagrilmiyorlar.
const bosVekil = new Proxy({}, { get: () => async () => undefined });
const orders = new OrdersService(
  prisma,
  new LedgerService(prisma),
  new WalletService(prisma),
  new OrderStatusService(),
  { gonderSms: async () => undefined },
  new MarketService(prisma, bosVekil, bosVekil),
);

const ON = `__TEST_SEC_${Date.now()}`;
let gecti = 0;
let kaldi = 0;

function ok(ad, sonuc, detay = '') {
  if (sonuc) { gecti++; console.log(`  GECTI  ${ad}${detay ? ' — ' + detay : ''}`); }
  else { kaldi++; console.log(`  KALDI  ${ad}${detay ? ' — ' + detay : ''}`); }
}

async function hataBekle(ad, fn, parca) {
  try {
    await fn();
    ok(ad, false, 'hata beklendi, gelmedi');
  } catch (e) {
    const m = e?.response?.message ?? e?.message ?? String(e);
    ok(ad, String(m).includes(parca), `"${m}"`);
  }
}

async function kur() {
  const user = await prisma.user.create({
    data: { phone: ON.slice(0, 20), name: 'Test', status: 'ACTIVE' },
  });
  const seller = await prisma.seller.create({
    data: {
      ownerUserId: user.id, sellerType: 'RESTORAN',
      legalName: `${ON} AS`, displayName: ON, status: 'ACTIVE',
    },
  });
  const magaza = (dikey, komisyonBinde) => prisma.store.create({
    data: {
      ownerId: user.id, sellerId: seller.id, name: `${ON}-${dikey}`,
      slug: `${ON}-${dikey}`.toLowerCase(), type: 'RESTAURANT',
      businessUnit: dikey, commissionRate: komisyonBinde, isActive: true,
    },
  });
  // MARKET: fiyat dogrudan satis fiyati. CARSI: komisyon %8 (800 binde).
  const marketMagaza = await magaza('MARKET', 1000);
  const carsiMagaza = await magaza('CARSI', 800);

  const marketUrun = await prisma.product.create({
    data: {
      storeId: marketMagaza.id, name: `${ON} Doner`, slug: `${ON}-doner`.toLowerCase(),
      price: 10000n, stock: 100, isActive: true, kdvOrani: 10,
    },
  });

  // CARSI urunu: vitrin fiyati ve kirilim GERCEK fiyat hattindan uretilir.
  const carsiNet = 20000n;
  const h = vitrinFiyatHesapla(carsiNet, 1, 1, 'A', 10, 8n);
  if (!h.ok) throw new Error(h.sebep);
  const carsiUrun = await prisma.product.create({
    data: {
      storeId: carsiMagaza.id, name: `${ON} Kolye`, slug: `${ON}-kolye`.toLowerCase(),
      price: h.vitrinKurus, netFiyat: carsiNet, stock: 100, isActive: true, kdvOrani: 10,
      komisyonTutari: h.komisyonKurus,
      kargoTutari: h.kargoKurus + h.yuvarlamaKurus,
      malKdvTutari: h.malKdvKurus, hizmetKdvTutari: h.hizmetKdvKurus,
      desi: 1, weightKg: 1, satisModeli: 'A',
    },
  });

  const grupYap = async (storeId, ad, min, max, zorunlu, secenekler) => {
    const g = await prisma.optionGroup.create({
      data: { storeId, name: ad, minSecim: min, maxSecim: max, zorunlu },
    });
    const o = [];
    for (const [sad, ucret] of secenekler) {
      o.push(await prisma.option.create({
        data: { optionGroupId: g.id, name: sad, ekUcret: BigInt(ucret) },
      }));
    }
    return { g, o };
  };

  // "Sos" secmeli (0..2), "Boy" ZORUNLU tek secim (1..1).
  const sos = await grupYap(marketMagaza.id, 'Sos', 0, 2, false, [['Ketcap', 500], ['Mayonez', 700]]);
  const boy = await grupYap(marketMagaza.id, 'Boy', 1, 1, true, [['Normal', 0], ['Buyuk', 2500]]);
  await prisma.productOptionGroup.createMany({
    data: [
      { productId: marketUrun.id, optionGroupId: sos.g.id, sortOrder: 0 },
      { productId: marketUrun.id, optionGroupId: boy.g.id, sortOrder: 1 },
    ],
  });

  // CARSI urunune secmeli grup: ek ucret 1000 kurus NET.
  const kaplama = await grupYap(carsiMagaza.id, 'Kaplama', 0, 1, false, [['Altin', 1000]]);
  await prisma.productOptionGroup.create({
    data: { productId: carsiUrun.id, optionGroupId: kaplama.g.id, sortOrder: 0 },
  });

  // Senaryo 6: ayni magazada ama BU URUNE BAGLI OLMAYAN secenek.
  const baskaGrup = await grupYap(marketMagaza.id, 'Bagsiz', 0, 1, false, [['Yabanci', 100]]);

  const adres = await prisma.address.create({
    data: { userId: user.id, city: 'Diyarbakir', district: 'Kayapinar', line1: 'Test sok. 1' },
  });
  await prisma.wallet.create({ data: { userId: user.id, type: 'USER', balance: 100000000n } });

  return { user, marketUrun, carsiUrun, sos, boy, kaplama, baskaGrup, adres };
}

async function temizle(f) {
  if (!f) return;
  const urunler = [f.marketUrun?.id, f.carsiUrun?.id].filter(Boolean);
  const siparisler = await prisma.order.findMany({ where: { userId: f.user.id }, select: { id: true, orderNo: true } });
  const sipIdler = siparisler.map((s) => s.id);
  const sipNolar = siparisler.map((s) => s.orderNo);
  await prisma.orderItemOption.deleteMany({ where: { orderItem: { orderId: { in: sipIdler } } } });
  await prisma.delivery.deleteMany({ where: { orderId: { in: sipIdler } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: sipIdler } } });
  await prisma.order.deleteMany({ where: { id: { in: sipIdler } } });
  if (sipNolar.length) {
    await prisma.ledgerEntry.deleteMany({ where: { transaction: { orderNo: { in: sipNolar } } } });
    await prisma.transaction.deleteMany({ where: { orderNo: { in: sipNolar } } });
  }
  await prisma.cartItem.deleteMany({ where: { cart: { userId: f.user.id } } });
  await prisma.cart.deleteMany({ where: { userId: f.user.id } });
  await prisma.productOptionGroup.deleteMany({ where: { productId: { in: urunler } } });
  await prisma.option.deleteMany({ where: { group: { store: { name: { startsWith: ON } } } } });
  await prisma.optionGroup.deleteMany({ where: { store: { name: { startsWith: ON } } } });
  await prisma.product.deleteMany({ where: { id: { in: urunler } } });
  await prisma.store.deleteMany({ where: { name: { startsWith: ON } } });
  await prisma.seller.deleteMany({ where: { displayName: { startsWith: ON } } });
  await prisma.address.deleteMany({ where: { userId: f.user.id } });
  await prisma.wallet.deleteMany({ where: { userId: f.user.id } });
  await prisma.user.deleteMany({ where: { id: f.user.id } });
}

(async () => {
  let f;
  try {
    f = await kur();
    const uid = f.user.id;
    const P = f.marketUrun.id;
    const [ketcap] = f.sos.o;
    const [normal, buyuk] = f.boy.o;

    // ---- 1) SECIMSIZ EKLEME: sonuc Faz 3 oncesiyle AYNI ----
    // Market urununun ZORUNLU "Boy" grubu var; secimsiz ekleme icin zorunlu
    // grubu olmayan Carsi urunu kullaniliyor (zorunlu kurali senaryo 4'te).
    console.log('1) Secimsiz ekleme -> davranis degismedi');
    let g = await cart.addItem(uid, { productId: f.carsiUrun.id, quantity: 2 });
    const k = g.items[0];
    ok('kalem yazildi', g.items.length === 1);
    ok('secimler bos', k.secimler.length === 0);
    ok('ekUcretToplam 0', k.ekUcretToplam === 0n);
    ok('satirBirimFiyat == unitPrice', k.satirBirimFiyat === k.unitPrice);
    ok('lineTotal == unitPrice * quantity', k.lineTotal === k.unitPrice * 2n);
    await cart.clear(uid, 'CARSI');

    // ---- 2) AYNI URUN, FARKLI SECIM = AYRI KALEM (Karar 1) ----
    console.log('\n2) Ayni urun + farkli secim -> AYRI KALEM');
    await cart.addItem(uid, { productId: P, optionIds: [normal.id] });
    g = await cart.addItem(uid, { productId: P, optionIds: [buyuk.id] });
    ok('iki ayri kalem', g.items.length === 2, `kalem sayisi=${g.items.length}`);
    const buyukKalem = g.items.find((i) => i.secimler.some((s) => s.optionId === buyuk.id));
    ok('ek ucret satira yansidi', buyukKalem.ekUcretToplam === 2500n, `${buyukKalem.ekUcretToplam}`);
    ok('lineTotal = (birim + ek) * adet', buyukKalem.lineTotal === 12500n, `${buyukKalem.lineTotal}`);

    // ---- 3) AYNI URUN, AYNI SECIM = MIKTAR ARTAR ----
    console.log('\n3) Ayni urun + ayni secim -> miktar artar');
    g = await cart.addItem(uid, { productId: P, optionIds: [buyuk.id], quantity: 3 });
    ok('kalem sayisi degismedi', g.items.length === 2, `kalem sayisi=${g.items.length}`);
    const artan = g.items.find((i) => i.secimler.some((s) => s.optionId === buyuk.id));
    ok('miktar 1+3=4', artan.quantity === 4, `${artan.quantity}`);
    ok('secim tekrar yazilmadi', artan.secimler.length === 1);
    // Sira duyarsizlik: ayni kume ters sirada gelirse yine ayni kalem.
    g = await cart.addItem(uid, { productId: P, optionIds: [ketcap.id, normal.id] });
    const oncekiSayi = g.items.length;
    g = await cart.addItem(uid, { productId: P, optionIds: [normal.id, ketcap.id] });
    ok('secim kumesi sira duyarsiz', g.items.length === oncekiSayi, `${oncekiSayi} -> ${g.items.length}`);
    await cart.clear(uid, 'MARKET');

    // ---- 4) ZORUNLU GRUP BOS -> 400 ----
    console.log('\n4) Zorunlu grup bos birakildi');
    await hataBekle('zorunlu grup reddedildi',
      () => cart.addItem(uid, { productId: P, optionIds: [ketcap.id] }), 'zorunlu');

    // ---- 5) maxSecim ASIMI -> 400 ----
    console.log('\n5) maxSecim asimi');
    await hataBekle('max asimi reddedildi',
      () => cart.addItem(uid, { productId: P, optionIds: [normal.id, buyuk.id] }), 'en fazla');

    // ---- 6) BASKA URUNUN SECENEGI -> 400 ----
    console.log('\n6) Urune bagli olmayan secenek');
    await hataBekle('bagsiz secenek reddedildi',
      () => cart.addItem(uid, { productId: P, optionIds: [normal.id, f.baskaGrup.o[0].id] }),
      'bu ürüne ait değil');

    // ---- 7) CARSI: ek ucret tam fiyat hattindan + dagitim == subtotal ----
    console.log('\n7) Carsi ek ucreti + checkout dagitimi');
    const altin = f.kaplama.o[0];
    g = await cart.addItem(uid, { productId: f.carsiUrun.id, optionIds: [altin.id], quantity: 2 });
    const cKalem = g.items[0];
    const beklenen = ekUcretHesapla(1000n, 10, 8n);
    ok('ek ucret vitrin fiyatina cevrildi', cKalem.ekUcretToplam === beklenen.vitrinKurus,
      `net 1000 -> ${cKalem.ekUcretToplam}`);
    ok('net ustune komisyon+KDV eklendi', cKalem.ekUcretToplam > 1000n);

    const satir = await prisma.cartItemOption.findFirst({ where: { optionId: altin.id } });
    ok('kirilim secim satirinda ve birebir tutuyor',
      satir.ekUcret === satir.netFiyat + satir.komisyonTutari + satir.malKdvTutari + satir.hizmetKdvTutari,
      `${satir.netFiyat}+${satir.komisyonTutari}+${satir.malKdvTutari}+${satir.hizmetKdvTutari}=${satir.ekUcret}`);

    const siparis = await orders.checkout(uid, { addressId: f.adres.id }, undefined, 'CARSI');
    const dagitim = siparis.netRevenue + siparis.commission + siparis.vat + siparis.deliveryFee;
    ok('dagitim == subtotal', dagitim === siparis.subtotal, `${dagitim} vs ${siparis.subtotal}`);
    const oi = siparis.items[0];
    ok('OrderItem.unitPrice ek ucreti icerir',
      oi.unitPrice === f.carsiUrun.price + beklenen.vitrinKurus, `${oi.unitPrice}`);
    ok('lineTotal = unitPrice * quantity', oi.lineTotal === oi.unitPrice * 2n);
    ok('subtotal = Σ lineTotal', siparis.subtotal === oi.lineTotal);
    ok('OrderItemOption snapshot yazildi',
      oi.secimler.length === 1 && oi.secimler[0].optionAdi === 'Altin'
      && oi.secimler[0].ekUcret === beklenen.vitrinKurus);

    console.log(`\n=== GECTI: ${gecti} | KALDI: ${kaldi} ===`);
  } catch (e) {
    console.error('\nBETIK HATASI:', e?.response?.message ?? e?.message ?? e);
    kaldi++;
  } finally {
    await temizle(f).catch((e) => console.error('temizlik:', e.message));
    await prisma.$disconnect();
    process.exit(kaldi > 0 ? 1 : 0);
  }
})();
