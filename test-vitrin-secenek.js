// FAZ 3 / ADIM 4b — VITRINDE SECENEK OKUMA
// Calistir: npm run build && node test-vitrin-secenek.js
//
// ASIL KURAL: vitrinde gorulen ek ucret ile sepette odenen ek ucret AYRISAMAZ.
// Bu yuzden test iki tarafi da gercek kodla calistirip karsilastiriyor
// (CatalogService.getPublicProduct / listProducts ve CartService.addItem).
//
// YALNIZCA YEREL DOCKER DB: kapi localhost disinda calismayi reddeder.
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

const u = new URL(process.env.DATABASE_URL || 'postgres://yok/yok');
if (!['localhost', '127.0.0.1'].includes(u.hostname)) {
  console.error(`REDDEDILDI: bu betik yalnizca yerel DB'de calisir. Hedef: ${u.hostname}:${u.port}`);
  process.exit(1);
}
console.log(`DB: ${u.hostname}:${u.port}${u.pathname}\n`);

const { PrismaClient } = require('@prisma/client');
const { CatalogService } = require('./dist/src/catalog/catalog.service');
const { CartService } = require('./dist/src/cart/cart.service');
const { MarketService } = require('./dist/src/market/market.service');
const { vitrinFiyatHesapla, ekUcretHesapla } = require('./dist/src/delivery/pricing');

const prisma = new PrismaClient();
// MarketService GERCEK: urunDetay yetkisi (assertOwner) gercekten sinaniyor.
// Onun audit / satici durumu bagimliliklari bu yolda cagrilmiyor -> bos vekil.
const bosVekil = new Proxy({}, { get: () => async () => undefined });
const katalog = new CatalogService(prisma, new MarketService(prisma, bosVekil, bosVekil));
const cart = new CartService(prisma);

// Muhasebe kirilimi: musteriye ASLA gitmemeli, saticiya gitmeli.
const KIRILIM = ['netFiyat', 'komisyonTutari', 'kargoTutari', 'malKdvTutari', 'hizmetKdvTutari'];

const ON = `__TEST_VIT_${Date.now()}`;
let gecti = 0;
let kaldi = 0;
function ok(ad, sonuc, detay = '') {
  if (sonuc) { gecti++; console.log(`  GECTI  ${ad}${detay ? ' — ' + detay : ''}`); }
  else { kaldi++; console.log(`  KALDI  ${ad}${detay ? ' — ' + detay : ''}`); }
}

async function kur() {
  const user = await prisma.user.create({ data: { phone: ON.slice(0, 20), name: 'Test', status: 'ACTIVE' } });
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
  const marketMagaza = await magaza('MARKET', 1000);
  const carsiMagaza = await magaza('CARSI', 800);

  const marketUrun = await prisma.product.create({
    data: {
      storeId: marketMagaza.id, name: `${ON} Doner`, slug: `${ON}-doner`.toLowerCase(),
      price: 10000n, stock: 100, isActive: true, kdvOrani: 10,
    },
  });
  // Secenegi OLMAYAN urun: yanit sekli degismedigini gostermek icin.
  const sadeUrun = await prisma.product.create({
    data: {
      storeId: marketMagaza.id, name: `${ON} Ayran`, slug: `${ON}-ayran`.toLowerCase(),
      price: 2000n, stock: 100, isActive: true, kdvOrani: 1,
    },
  });

  const carsiNet = 20000n;
  const h = vitrinFiyatHesapla(carsiNet, 1, 1, 'A', 10, 8n);
  if (!h.ok) throw new Error(h.sebep);
  const carsiUrun = await prisma.product.create({
    data: {
      storeId: carsiMagaza.id, name: `${ON} Kolye`, slug: `${ON}-kolye`.toLowerCase(),
      price: h.vitrinKurus, netFiyat: carsiNet, stock: 100, isActive: true, kdvOrani: 10,
      komisyonTutari: h.komisyonKurus, kargoTutari: h.kargoKurus + h.yuvarlamaKurus,
      malKdvTutari: h.malKdvKurus, hizmetKdvTutari: h.hizmetKdvKurus,
      desi: 1, weightKg: 1, satisModeli: 'A',
    },
  });

  const grupYap = async (storeId, ad, min, max, zorunlu, secenekler, grupAktif = true) => {
    const g = await prisma.optionGroup.create({
      data: { storeId, name: ad, minSecim: min, maxSecim: max, zorunlu, isActive: grupAktif },
    });
    const o = [];
    for (const [sad, ucret, aktif] of secenekler) {
      o.push(await prisma.option.create({
        data: { optionGroupId: g.id, name: sad, ekUcret: BigInt(ucret), isActive: aktif !== false },
      }));
    }
    return { g, o };
  };

  // MARKET urunu: bir aktif grup (biri PASIF secenek) + bir PASIF grup.
  const sos = await grupYap(marketMagaza.id, 'Sos', 0, 2, false,
    [['Ketcap', 500], ['Mayonez', 700], ['Kaldirilmis', 900, false]]);
  const kapali = await grupYap(marketMagaza.id, 'Kapali grup', 0, 1, false, [['Gizli', 1234]], false);
  const boy = await grupYap(marketMagaza.id, 'Boy', 1, 1, true, [['Normal', 0], ['Buyuk', 2500]]);
  await prisma.productOptionGroup.createMany({
    data: [
      { productId: marketUrun.id, optionGroupId: sos.g.id, sortOrder: 0 },
      { productId: marketUrun.id, optionGroupId: kapali.g.id, sortOrder: 1 },
      { productId: marketUrun.id, optionGroupId: boy.g.id, sortOrder: 2 },
    ],
  });

  // CARSI urunu: ek ucret 1000 kurus NET.
  const kaplama = await grupYap(carsiMagaza.id, 'Kaplama', 0, 1, false, [['Altin', 1000]]);
  await prisma.productOptionGroup.create({
    data: { productId: carsiUrun.id, optionGroupId: kaplama.g.id, sortOrder: 0 },
  });

  // Onay bekleyen urun: satici ucunun (listPending) kirilimi hala gordugunu
  // gostermek icin. Kirilim degerleri ACIK yaziliyor ki "0 mi yok mu" karismasin.
  const bekleyenUrun = await prisma.product.create({
    data: {
      storeId: marketMagaza.id, name: `${ON} Bekleyen`, slug: `${ON}-bekleyen`.toLowerCase(),
      price: 5000n, netFiyat: 4000n, komisyonTutari: 320n, kargoTutari: 400n,
      malKdvTutari: 400n, hizmetKdvTutari: 64n, stock: 5, isActive: false, kdvOrani: 10,
    },
  });
  // VARYANTLAR (market urunu):
  //  - Kucuk: fiyat ve stok NULL -> urunun degeri gecerli (etkinFiyat/etkinStok)
  //  - Buyuk: kendi fiyati + kendi stogu
  //  - Tukenmis: stok 0 -> vitrinde GIZLENMEZ, stok:0 ile doner
  //  - Kaldirilmis: isActive:false -> vitrinde YOK
  // Carsi kirilim kolonlari da dolduruluyor: public uctan SIZMADIGI gorulsun.
  const varyant = (ad, price, stock, isActive, ekstra = {}) => prisma.productVariant.create({
    data: { productId: marketUrun.id, name: ad, price, stock, isActive, ...ekstra },
  });
  const vKucuk = await varyant('Kucuk', null, null, true);
  const vBuyuk = await varyant('Buyuk', 13000n, 7, true, {
    netFiyat: 9000n, komisyonTutari: 720n, kargoTutari: 1000n,
    malKdvTutari: 900n, hizmetKdvTutari: 344n,
  });
  const vTukenmis = await varyant('Tukenmis', 11000n, 0, true);
  await varyant('Kaldirilmis', 12000n, 5, false);

  // Magazayla ilgisi olmayan kullanici: urunDetay yetkisinin gercekten
  // kapandigini gostermek icin (bos vekil degil, gercek MarketService).
  const yabanci = await prisma.user.create({
    data: { phone: `${ON.slice(0, 19)}Y`, name: 'Yabanci', status: 'ACTIVE' },
  });

  return {
    user, yabanci, marketMagaza, marketUrun, sadeUrun, carsiUrun, bekleyenUrun,
    sos, boy, kaplama, kapali, vKucuk, vBuyuk, vTukenmis,
  };
}

async function temizle(f) {
  if (!f) return;
  const urunler = [f.marketUrun?.id, f.sadeUrun?.id, f.carsiUrun?.id, f.bekleyenUrun?.id].filter(Boolean);
  await prisma.cartItem.deleteMany({ where: { cart: { userId: f.user.id } } });
  await prisma.productVariant.deleteMany({ where: { productId: { in: urunler } } });
  await prisma.cart.deleteMany({ where: { userId: f.user.id } });
  await prisma.productOptionGroup.deleteMany({ where: { productId: { in: urunler } } });
  await prisma.option.deleteMany({ where: { group: { store: { name: { startsWith: ON } } } } });
  await prisma.optionGroup.deleteMany({ where: { store: { name: { startsWith: ON } } } });
  await prisma.product.deleteMany({ where: { id: { in: urunler } } });
  await prisma.store.deleteMany({ where: { name: { startsWith: ON } } });
  await prisma.seller.deleteMany({ where: { displayName: { startsWith: ON } } });
  await prisma.user.deleteMany({ where: { id: { in: [f.user.id, f.yabanci?.id].filter(Boolean) } } });
}

(async () => {
  let f;
  try {
    f = await kur();

    // ---- 1) CARSI: musteri fiyati doner, satici neti DEGIL ----
    console.log('1) Carsi urun detayi -> musteri fiyati');
    const cUrun = await katalog.getPublicProduct(f.carsiUrun.id);
    const beklenen = ekUcretHesapla(1000n, 10, 8n).vitrinKurus;
    const altin = cUrun.secenekGruplari[0].secenekler[0];
    ok('grup doner', cUrun.secenekGruplari.length === 1 && cUrun.secenekGruplari[0].name === 'Kaplama');
    ok('ek ucret musteri fiyati', altin.ekUcret === beklenen, `${altin.ekUcret}`);
    ok('satici neti SIZMIYOR', altin.ekUcret !== 1000n, `ham 1000 degil, ${altin.ekUcret}`);
    ok('magaza alani yanitta yok', cUrun.store === undefined);

    // ---- 2) ASIL KURAL: vitrin fiyati == sepete yazilan ek ucret ----
    console.log('\n2) Vitrinde gorulen == sepette odenen');
    const g = await cart.addItem(f.user.id, { productId: f.carsiUrun.id, optionIds: [altin.id] });
    ok('sepet ek ucreti vitrinle ayni', g.items[0].ekUcretToplam === altin.ekUcret,
      `vitrin ${altin.ekUcret} / sepet ${g.items[0].ekUcretToplam}`);
    await cart.clear(f.user.id, 'CARSI');

    // ---- 3) CARSI DISI: ekUcret oldugu gibi ----
    console.log('\n3) Carsi disi dikey -> ekUcret dogrudan');
    const mUrun = await katalog.getPublicProduct(f.marketUrun.id);
    const sosGrubu = mUrun.secenekGruplari.find((x) => x.name === 'Sos');
    const ketcap = sosGrubu.secenekler.find((s) => s.name === 'Ketcap');
    ok('ek ucret ham deger', ketcap.ekUcret === 500n, `${ketcap.ekUcret}`);

    // ---- 4) PASIF secenek ve PASIF grup vitrinde YOK ----
    console.log('\n4) Pasif kayitlar suzuluyor');
    ok('pasif secenek gizli', !sosGrubu.secenekler.some((s) => s.name === 'Kaldirilmis'),
      `secenekler: ${sosGrubu.secenekler.map((s) => s.name).join(', ')}`);
    ok('pasif grup gizli', !mUrun.secenekGruplari.some((x) => x.name === 'Kapali grup'),
      `gruplar: ${mUrun.secenekGruplari.map((x) => x.name).join(', ')}`);

    // ---- 5) Istemci dogrulamasi icin sinirlar doner ----
    console.log('\n5) Grup sinirlari yanitta');
    const boyGrubu = mUrun.secenekGruplari.find((x) => x.name === 'Boy');
    ok('zorunlu/min/max doner',
      boyGrubu.zorunlu === true && boyGrubu.minSecim === 1 && boyGrubu.maxSecim === 1);
    ok('grup sirasi urun bagindan', mUrun.secenekGruplari[0].name === 'Sos',
      mUrun.secenekGruplari.map((x) => x.name).join(' < '));

    // ---- 6) LISTE ucu da ayni fiyati veriyor ----
    console.log('\n6) Urun listesi ucu');
    const liste = await katalog.listProducts(f.marketUrun.storeId);
    const listeDoner = liste.find((p) => p.id === f.marketUrun.id);
    const listeKetcap = listeDoner.secenekGruplari
      .find((x) => x.name === 'Sos').secenekler.find((s) => s.name === 'Ketcap');
    ok('listede de secenekler var', listeKetcap.ekUcret === 500n, `${listeKetcap.ekUcret}`);
    ok('listede magaza alani yok', listeDoner.store === undefined);

    const carsiListe = await katalog.listProducts(f.carsiUrun.storeId);
    const carsiListeUrun = carsiListe.find((p) => p.id === f.carsiUrun.id);
    ok('listede de musteri fiyati',
      carsiListeUrun.secenekGruplari[0].secenekler[0].ekUcret === beklenen,
      `${carsiListeUrun.secenekGruplari[0].secenekler[0].ekUcret}`);

    // ---- 7) Secenegi olmayan urun -> gorunum degismedi ----
    console.log('\n7) Secenegi olmayan urun');
    const sade = await katalog.getPublicProduct(f.sadeUrun.id);
    ok('secenekGruplari bos dizi', Array.isArray(sade.secenekGruplari) && sade.secenekGruplari.length === 0);
    ok('urun alanlari yerinde', sade.id === f.sadeUrun.id && sade.price === 2000n);

    // ---- 8) MUHASEBE KIRILIMI musteriye GITMEZ, saticiya GIDER ----
    console.log('\n8) Muhasebe kirilimi sizintisi');
    const eksikOlanlar = KIRILIM.filter((a) => cUrun[a] === undefined);
    ok('detay ucunda kirilim YOK', eksikOlanlar.length === KIRILIM.length,
      `gizlenen: ${eksikOlanlar.join(', ') || 'HICBIRI'}`);
    ok('vitrin fiyati yerinde', cUrun.price === f.carsiUrun.price, `${cUrun.price}`);
    const listeCarsi = (await katalog.listProducts(f.carsiUrun.storeId)).find((p) => p.id === f.carsiUrun.id);
    ok('liste ucunda da kirilim YOK', KIRILIM.every((a) => listeCarsi[a] === undefined));

    const saticiDetay = await katalog.urunDetay(f.carsiUrun.id, f.user.id, []);
    ok('satici detayi kirilimi GORUYOR',
      KIRILIM.every((a) => saticiDetay[a] !== undefined) && saticiDetay.netFiyat === 20000n,
      `netFiyat=${saticiDetay.netFiyat}`);

    const bekleyenler = await katalog.listPending(f.marketMagaza.id, f.user.id, []);
    const bekleyen = bekleyenler.find((p) => p.id === f.bekleyenUrun.id);
    ok('listPending kirilimi GORMEYE devam ediyor',
      bekleyen && bekleyen.netFiyat === 4000n && bekleyen.komisyonTutari === 320n);

    try {
      await katalog.urunDetay(f.carsiUrun.id, f.yabanci.id, []);
      ok('yabanciya kapali', false, 'hata beklendi, gelmedi');
    } catch (e) {
      const m = e?.response?.message ?? e?.message ?? String(e);
      ok('yabanciya kapali', String(m).includes('ait değil'), `"${m}"`);
    }

    // ---- 9) VARYANTLAR public ucta ----
    console.log('\n9) Varyantlar vitrinde');
    const vUrun = await katalog.getPublicProduct(f.marketUrun.id);
    const vAd = (a) => vUrun.varyantlar.find((v) => v.name === a);
    ok('aktif varyantlar doner', vUrun.varyantlar.length === 3,
      vUrun.varyantlar.map((v) => v.name).join(', '));
    ok('pasif varyant gizli', !vAd('Kaldirilmis'));

    // NULL fiyat/stok -> urunun degeri (etkinFiyat/etkinStok)
    ok('NULL fiyat urunden geliyor', vAd('Kucuk').fiyat === 10000n, `${vAd('Kucuk').fiyat}`);
    ok('NULL stok urunden geliyor', vAd('Kucuk').stok === 100, `${vAd('Kucuk').stok}`);
    ok('NULL varyantta fiyat farki 0', vAd('Kucuk').fiyatFarki === 0n);

    ok('varyant kendi fiyatini kullaniyor', vAd('Buyuk').fiyat === 13000n);
    ok('fiyat farki hesaplandi', vAd('Buyuk').fiyatFarki === 3000n, `${vAd('Buyuk').fiyatFarki}`);
    ok('varyant kendi stogunu kullaniyor', vAd('Buyuk').stok === 7);

    ok('tukenmis varyant GIZLENMIYOR', !!vAd('Tukenmis') && vAd('Tukenmis').stok === 0);

    // Varyantta da muhasebe kolonlari var; sizmadigini dogrula.
    ok('varyant kirilimi SIZMIYOR', KIRILIM.every((a) => vAd('Buyuk')[a] === undefined),
      `alanlar: ${Object.keys(vAd('Buyuk')).join(', ')}`);

    // Vitrinde gorulen varyant fiyati == sepete yazilan birim fiyat.
    const vg = await cart.addItem(f.user.id, {
      productId: f.marketUrun.id, variantId: f.vBuyuk.id, optionIds: [f.boy.o[0].id],
    });
    const vKalem = vg.items.find((i) => i.variantId === f.vBuyuk.id);
    ok('sepet birim fiyati vitrinle ayni', vKalem.unitPrice === vAd('Buyuk').fiyat,
      `vitrin ${vAd('Buyuk').fiyat} / sepet ${vKalem.unitPrice}`);
    await cart.clear(f.user.id, 'MARKET');

    // Liste ucu ve varyantsiz urun
    const listeM = (await katalog.listProducts(f.marketUrun.storeId)).find((p) => p.id === f.marketUrun.id);
    ok('listede de varyantlar var', listeM.varyantlar.length === 3);
    ok('varyantsiz urunde bos dizi',
      Array.isArray(sade.varyantlar) && sade.varyantlar.length === 0);

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
