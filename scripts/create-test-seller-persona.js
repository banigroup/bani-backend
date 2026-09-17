// TEST SATICI PERSONASI URETICI (CLI).
//
// Kullanim:
//   node scripts/create-test-seller-persona.js [--dikey MARKET] [--ad "Test Satici"]
//
// NE YAPAR: her calistirmada YENI bir sentetik E.164 numara uretir ve o numara
// icin Satici Paneli'nin acilabilmesi icin gereken EN AZ satir kumesini yazar:
//
//   users        -> ACTIVE + phoneVerified
//   user_roles   -> MERCHANT (storeId NULL = platform kapsami)
//   sellers      -> ownerUserId, status ACTIVE
//   stores       -> ownerId + sellerId, isActive
//
// NEDEN MERCHANT SATIRI SART: /auth/otp/verify yeni kullaniciya yalnizca
// CUSTOMER veriyor ve CUSTOMER'da order:manage izni YOK - panel dashboard'u
// /market/seller/orders cagirdigi icin "Yetersiz izin" alir. MERCHANT'i veren
// bir kod yolu da henuz yok (onay adimi yazilmadi), bu yuzden satir buradan.
//
// NEDEN sellers SATIRI SART: /market/seller ucu
// seller.findFirst({ ownerUserId, deletedAt: null }) ile bakiyor; satir yoksa
// 404 doner ve tum ekranlar "Satici kaydi bulunamadi" gosterir.
//
// SABIT NUMARA YOK: numara her kosuda +90555111XXXX araliginda yeniden uretilir
// ve DB'de UNIQUE kontrolu yapilir. Cakisirsa yeniden uretir. VAR OLAN hicbir
// kayit guncellenmez/silinmez - yalnizca yeni satir yazilir.
//
// TEK ISLEM: dort tablo tek $transaction icinde yazilir; ortada hata cikarsa
// yarim persona kalmaz.
//
// KAYIT DEFTERI EN SONDA: DB islemi BASARIYLA bittikten sonra numara, gecici
// test telefonu kayit defterine (Redis, 60 dk) yazilir. Production'da devCode
// yalnizca bu kaydi olan numaralara doner (auth.service.devCodeIzinli).
//
// SIRA BILINCLI: DB once, Redis sonra. Redis yazimi patlarsa persona DB'de
// KALIR ve islem GERI ALINMAZ - satici/magaza is verisidir, kayit defteri ise
// gecici bir yetkidir; kalici veriyi gecici yetki yuzunden geri sarmak yanlis
// olurdu. Bu durumda script HATA ile biter ve TEST_PHONE_REGISTERED=false
// yazar; yetkiyi tekrar denemek icin script yeniden kosulabilir (yeni persona
// uretir) ya da kayit elle yapilir.
//
// ANAHTAR BICIMI TEK KAYNAKTAN: dist/src/auth/dev-otp/test-telefon-anahtar.js
// (TS kaynagi src/auth/dev-otp/test-telefon-anahtar.ts). Burada yeniden
// yazilsaydi biri degistiginde digeri sessizce kayardi; bu yuzden derlenmis
// hali require ediliyor ve dist yoksa script acik mesajla duruyor.
//
// REFERANS: prisma/seed.ts (User -> user_roles MERCHANT -> Seller -> Store
// zincirini bugunku semayla yazan tek guncel ornek). setup-admin.js ve
// create-stores.js referans ALINMADI: ilki kaldirilmis users.roles kolonuna,
// ikincisi sellerId'siz store.create'e dayaniyor - ikisi de bugun patlar.
const {
  PrismaClient,
  Role,
  SellerType,
  SellerStatus,
  SellerVerification,
  StoreType,
  BusinessUnit,
  UserStatus,
} = require('@prisma/client');

const path = require('path');

const prisma = new PrismaClient();

// Derlenmis anahtar yardimcisi (tek kaynak). Yoksa acik mesajla dur.
let testTelefonAnahtari;
let TEST_TELEFON_TTL_SANIYE;
try {
  const anahtarModulu = require(path.join(__dirname, '..', 'dist', 'src', 'auth', 'dev-otp', 'test-telefon-anahtar.js'));
  testTelefonAnahtari = anahtarModulu.testTelefonAnahtari;
  TEST_TELEFON_TTL_SANIYE = anahtarModulu.TEST_TELEFON_TTL_SANIYE;
} catch (e) {
  console.error('HATA: dist bulunamadi. Once `npm run build` calistirin (anahtar bicimi derlenmis kaynaktan okunuyor).');
  process.exit(1);
}

/**
 * Numarayi gecici test kayit defterine yazar.
 *
 * KISA OMURLU BAGLANTI: bu bir CLI; API surecindeki Redis baglantisini
 * paylasmasi mumkun degil. Uygulamaya YENI bir Redis bileseni EKLENMEDI -
 * burada ayni REDIS_URL'e acilip kapanan tek seferlik bir istemci var.
 *
 * DEGER ve TTL servisle ayni: value 1, sure TEST_TELEFON_TTL_SANIYE.
 */
async function kayitDefterineYaz(telefon) {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL tanimli degil (railway run --service Redis ... ile calistirin)');
  const Redis = require('ioredis');
  const istemci = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
  try {
    await istemci.connect();
    await istemci.set(testTelefonAnahtari(telefon), '1', 'EX', TEST_TELEFON_TTL_SANIYE);
  } finally {
    istemci.disconnect();
  }
}

const argv = process.argv.slice(2);
const deger = (ad, varsayilan) => {
  const i = argv.indexOf(ad);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : varsayilan;
};

// BANI test namespace'i: +90555111XXXX. 555 bloku gercek abone numaralarina
// denk gelmiyor; XXXX her personada degisir.
const TEST_ONEK = '+90555111';

function numaraUret() {
  const dort = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return TEST_ONEK + dort;
}

async function bosNumaraBul(denemeSayisi = 60) {
  for (let i = 0; i < denemeSayisi; i += 1) {
    const aday = numaraUret();
    const varMi = await prisma.user.findUnique({ where: { phone: aday }, select: { id: true } });
    if (!varMi) return aday;
  }
  throw new Error(`${TEST_ONEK}XXXX alani dolu: ${denemeSayisi} denemede bos numara bulunamadi`);
}

// stores.slug GLOBAL unique (satici basina degil), o yuzden cakisirsa rastgele
// ek ile tekrar denenir.
async function bosSlugBul(taban, denemeSayisi = 60) {
  for (let i = 0; i < denemeSayisi; i += 1) {
    const aday = i === 0 ? taban : `${taban}-${Math.random().toString(36).slice(2, 6)}`;
    const varMi = await prisma.store.findUnique({ where: { slug: aday }, select: { id: true } });
    if (!varMi) return aday;
  }
  throw new Error(`Slug uretilemedi (taban: ${taban})`);
}

function slugla(metin) {
  return metin
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function main() {
  const dikeyAdi = deger('--dikey', 'MARKET');
  if (!BusinessUnit[dikeyAdi]) {
    throw new Error(`Bilinmeyen dikey: ${dikeyAdi}. Gecerli: ${Object.keys(BusinessUnit).join(', ')}`);
  }
  const dikey = BusinessUnit[dikeyAdi];
  // Dikey -> magaza tipi. Panel tipe bakmiyor; tip vitrin tarafi icin anlamli.
  const magazaTipi =
    dikey === BusinessUnit.YEMEK ? StoreType.RESTAURANT
      : dikey === BusinessUnit.COFFEE ? StoreType.CAFE
        : dikey === BusinessUnit.CARSI ? StoreType.SHOP
          : StoreType.MARKET;
  const saticiTipi = dikey === BusinessUnit.YEMEK ? SellerType.RESTORAN : SellerType.MARKET;

  const telefon = await bosNumaraBul();
  const sonDort = telefon.slice(-4);
  const gorunenAd = `${deger('--ad', 'Test Satici')} ${sonDort}`;
  const slug = await bosSlugBul(slugla(gorunenAd) || `test-satici-${sonDort}`);

  const sonuc = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        phone: telefon,
        phoneVerified: true,
        status: UserStatus.ACTIVE,
        name: 'Test',
        surname: `Satici ${sonDort}`,
      },
    });

    // storeId ACIKCA null: kullanici-rolleri.ts rolleri storeId'ye gore ayiriyor
    // ve magaza kapsamli bir MERCHANT satiri platform izinlerini VERMEZ.
    const rol = await tx.userRole.create({
      data: { userId: user.id, role: Role.MERCHANT, storeId: null },
    });

    // verification EKSIK birakildi: canli veride de boyle ve panelin hicbir
    // ekrani bu alana bakmiyor (dogrulama akisi ayri bir konu).
    const seller = await tx.seller.create({
      data: {
        ownerUserId: user.id,
        sellerType: saticiTipi,
        legalName: `${gorunenAd} Ltd. Sti.`,
        displayName: gorunenAd,
        status: SellerStatus.ACTIVE,
        verification: SellerVerification.EKSIK,
      },
    });

    const store = await tx.store.create({
      data: {
        ownerId: user.id,
        sellerId: seller.id,
        name: gorunenAd,
        slug,
        type: magazaTipi,
        businessUnit: dikey,
        isActive: true,
        city: 'Mersin',
      },
    });

    return { user, rol, seller, store };
  });

  // DB tamam; simdi gecici test yetkisi. Buradaki hata personayi GERI ALMAZ.
  let kayitTamam = false;
  let kayitHatasi = null;
  try {
    await kayitDefterineYaz(sonuc.user.phone);
    kayitTamam = true;
  } catch (e) {
    kayitHatasi = e.message;
  }

  console.log('TEST_PHONE=' + sonuc.user.phone);
  console.log('USER_ID=' + sonuc.user.id);
  console.log('SELLER_ID=' + sonuc.seller.id);
  console.log('STORE_ID=' + sonuc.store.id);
  console.log('STORE_SLUG=' + sonuc.store.slug);
  console.log('TEST_PHONE_REGISTERED=' + kayitTamam);
  console.log('TEST_PHONE_TTL_SECONDS=' + (kayitTamam ? TEST_TELEFON_TTL_SANIYE : 0));

  if (!kayitTamam) {
    // Persona DB'de duruyor ama numara devCode almaya YETKILI DEGIL.
    throw new Error('Kayit defterine yazilamadi (persona DB\'de kaldi): ' + kayitHatasi);
  }
}

main()
  .catch((e) => {
    console.error('HATA: ' + e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
