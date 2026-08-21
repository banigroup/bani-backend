// FAZ 1 / C3 — MAGAZA KAPSAM DOGRULAMA MATRISI
// Calistir: npm run build && node test-magaza-kapsam.js
//
// GERCEK KODU calistirir (dist/): MarketService.erisebilir / assertOwner /
// sahipVeyaYonetici, JwtStrategy.validate, rolleriAyir. Mantik KOPYALANMADI.
//
// BLOK A bugunku davranisi dogrular ve GECMELIDIR.
// BLOK B, C4'un uretecegi davranis farkini BUGUNDEN sabitler; bugun kirmizi
// olmasi BEKLENIR ve cikis kodunu ETKILEMEZ.
//
// YALNIZCA YEREL DOCKER DB. Fixture'lar benzersiz onekle yaratilir, sonunda
// tamamen silinir.
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
const { MarketService } = require('./dist/src/market/market.service');
const { JwtStrategy } = require('./dist/src/auth/strategies/jwt.strategy');
const { rolleriAyir } = require('./dist/src/common/rbac/kullanici-rolleri');

const prisma = new PrismaClient();
const auditCasus = { record: async () => {} };
// saticiDurum yalnizca satici durum makinesinde kullaniliyor; erisim yollari
// (erisebilir/assertOwner/sahipVeyaYonetici) ona hic dokunmuyor.
const saticiDurumCasus = {};
const market = new MarketService(prisma, auditCasus, saticiDurumCasus);
const jwt = new JwtStrategy({ get: () => 'test-secret' }, prisma);

const ON = `__TEST_KAPSAM_${Date.now()}`;
let gecti = 0;
let kaldi = 0;
function ok(ad, sonuc, detay = '') {
  if (sonuc) { gecti++; console.log(`  GECTI  ${ad}${detay ? ' — ' + detay : ''}`); }
  else { kaldi++; console.log(`  KALDI  ${ad}${detay ? ' — ' + detay : ''}`); }
}
// BLOK B: olcum kaydi, gecti/kaldi sayaclarina KARISMAZ.
const blokB = [];
function olc(ad, bugun, c4Sonrasi, aciklama) {
  const uyumlu = bugun === c4Sonrasi;
  blokB.push({ ad, bugun, c4Sonrasi, aciklama });
  console.log(`  ${uyumlu ? 'ZATEN AYNI' : 'BEKLENEN: C4 ONCESI KIRMIZI'}  ${ad}`);
  console.log(`     bugun olculen: ${bugun}   |   C4 sonrasi olmasi gereken: ${c4Sonrasi}`);
  console.log(`     ${aciklama}`);
}
const sirala = (a) => [...(a || [])].sort().join(',');

const f = { users: [], sellers: [], stores: [] };

async function kullaniciYarat(etiket, roller) {
  const user = await prisma.user.create({
    // Telefon TAM onekle yaziliyor: kisaltilirsa SahipA/SahipB gibi ayni onekli
    // etiketler kesilip cakisir (unique ihlali).
    data: { phone: `${ON}_${etiket}`, name: etiket, status: 'ACTIVE' },
  });
  f.users.push(user.id);
  for (const r of roller) await prisma.userRole.create({ data: { userId: user.id, role: r, storeId: null } });
  return user;
}
async function magazaYarat(etiket, sahip) {
  const seller = await prisma.seller.create({
    data: { ownerUserId: sahip.id, sellerType: 'MARKET', legalName: `${ON} ${etiket}`, displayName: `${ON} ${etiket}`, status: 'ACTIVE' },
  });
  f.sellers.push(seller.id);
  const store = await prisma.store.create({
    data: { ownerId: sahip.id, sellerId: seller.id, name: `${ON} ${etiket}`, slug: `${ON.toLowerCase()}-${etiket.toLowerCase()}` },
  });
  f.stores.push(store.id);
  return store;
}
// erisebilir magaza NESNESI ister (id + ownerId yeter).
const auth = async (user) => jwt.validate({ sub: user.id, phone: user.phone, roles: [] });

(async () => {
  let sahipA, sahipB, personel, admin, yabanci, A, B;
  try {
    // ---------------- KURULUM ----------------
    console.log('KURULUM: iki magaza, dort kullanici');
    sahipA = await kullaniciYarat('SahipA', ['MERCHANT']);
    sahipB = await kullaniciYarat('SahipB', ['MERCHANT']);
    personel = await kullaniciYarat('Personel', ['CUSTOMER']);
    admin = await kullaniciYarat('Admin', ['ADMIN']);
    yabanci = await kullaniciYarat('Yabanci', ['CUSTOMER']);
    A = await magazaYarat('A', sahipA);
    B = await magazaYarat('B', sahipB);
    // Personel: HEM store_users HEM user_roles satiri (BLOK B ikisini tek tek
    // kaldirip erisim kararinin bugun HANGISINDEN geldigini olcecek).
    await prisma.storeUser.create({ data: { storeId: A.id, userId: personel.id, isActive: true } });
    await prisma.userRole.create({ data: { userId: personel.id, role: 'STORE_STAFF', storeId: A.id } });
    console.log(`  A=${A.id.slice(0, 8)} B=${B.id.slice(0, 8)} | personel: store_users@A + STORE_STAFF@A\n`);

    // ---------------- BLOK A ----------------
    console.log('BLOK A — BUGUN GECMELI');

    console.log('\n A1) erisebilir matrisi');
    const kisiler = [
      ['SahipA', sahipA, true, false],
      ['SahipB', sahipB, false, true],
      ['Personel', personel, true, false],
      ['Admin', admin, true, true],
      ['Yabanci', yabanci, false, false],
    ];
    for (const [ad, kisi, beklenenA, beklenenB] of kisiler) {
      const a = await auth(kisi);
      const eA = await market.erisebilir(A, kisi.id, a.roles);
      const eB = await market.erisebilir(B, kisi.id, a.roles);
      ok(`${ad} -> A:${beklenenA}`, eA === beklenenA, `olculen ${eA}`);
      ok(`${ad} -> B:${beklenenB}${ad === 'Personel' ? '  (EN KRITIK SATIR)' : ''}`, eB === beklenenB, `olculen ${eB}`);
    }

    console.log('\n A2) JwtStrategy.validate(Personel) — STORE_STAFF platform yetkisi vermiyor');
    const pAuth = await auth(personel);
    ok('roles === [CUSTOMER]', sirala(pAuth.roles) === 'CUSTOMER', sirala(pAuth.roles));
    ok('magazaRolleri === { A: [STORE_STAFF] }',
      Object.keys(pAuth.magazaRolleri).length === 1 && sirala(pAuth.magazaRolleri[A.id]) === 'STORE_STAFF',
      JSON.stringify(pAuth.magazaRolleri));
    ok('STORE_STAFF platform listesine SIZMADI', !pAuth.roles.includes('STORE_STAFF'));
    const ayrik = rolleriAyir(await prisma.userRole.findMany({ where: { userId: personel.id }, select: { role: true, storeId: true } }));
    ok('rolleriAyir ayni sonucu veriyor', sirala(ayrik.roles) === 'CUSTOMER' && sirala(ayrik.magazaRolleri[A.id]) === 'STORE_STAFF');

    console.log('\n A3) sahipVeyaYonetici — STORE_STAFF personel YONETEMEZ');
    const yonetebilir = async (kisi) => {
      const a = await auth(kisi);
      try { await market.sahipVeyaYonetici(A.id, kisi.id, a.roles); return true; } catch (e) { return false; }
    };
    ok('Personel -> false', (await yonetebilir(personel)) === false);
    ok('SahipA -> true', (await yonetebilir(sahipA)) === true);
    ok('Admin -> true', (await yonetebilir(admin)) === true);
    ok('Yabanci -> false', (await yonetebilir(yabanci)) === false);

    console.log('\n A4) Ayni kisi iki magazada');
    await prisma.userRole.create({ data: { userId: personel.id, role: 'STORE_STAFF', storeId: B.id } });
    await prisma.storeUser.create({ data: { storeId: B.id, userId: personel.id, isActive: true } });
    const ikiAuth = await auth(personel);
    ok('magazaRolleri iki ayri anahtar', Object.keys(ikiAuth.magazaRolleri).length === 2, JSON.stringify(Object.keys(ikiAuth.magazaRolleri).map((k) => k.slice(0, 8))));
    ok('roller karismiyor (her ikisi de yalniz STORE_STAFF)',
      sirala(ikiAuth.magazaRolleri[A.id]) === 'STORE_STAFF' && sirala(ikiAuth.magazaRolleri[B.id]) === 'STORE_STAFF');
    ok('platform rolleri hala yalniz CUSTOMER', sirala(ikiAuth.roles) === 'CUSTOMER', sirala(ikiAuth.roles));
    ok('erisebilir A -> true', (await market.erisebilir(A, personel.id, ikiAuth.roles)) === true);
    ok('erisebilir B -> true', (await market.erisebilir(B, personel.id, ikiAuth.roles)) === true);
    // A4 geri alinir: sonraki bloklar tek magazali personelle calisir.
    await prisma.userRole.deleteMany({ where: { userId: personel.id, storeId: B.id } });
    await prisma.storeUser.deleteMany({ where: { userId: personel.id, storeId: B.id } });
    const geriAuth = await auth(personel);
    ok('A4 geri alindi (tek magaza kaldi)', Object.keys(geriAuth.magazaRolleri).length === 1);

    console.log('\n A5) CASCADE — magaza silinince rol satiri da duser');
    const gSeller = await prisma.seller.create({
      data: { ownerUserId: sahipA.id, sellerType: 'MARKET', legalName: `${ON} G`, displayName: `${ON} G`, status: 'ACTIVE' },
    });
    const gecici = await prisma.store.create({
      data: { ownerId: sahipA.id, sellerId: gSeller.id, name: `${ON} Gecici`, slug: `${ON.toLowerCase()}-gecici` },
    });
    await prisma.userRole.create({ data: { userId: personel.id, role: 'STORE_STAFF', storeId: gecici.id } });
    const oncesi = await prisma.userRole.count({ where: { storeId: gecici.id } });
    await prisma.store.delete({ where: { id: gecici.id } });
    const sonrasi = await prisma.userRole.count({ where: { storeId: gecici.id } });
    await prisma.seller.delete({ where: { id: gSeller.id } }).catch(() => {});
    ok('rol satiri yazildi', oncesi === 1, `${oncesi}`);
    ok('magaza silinince rol satiri DUSTU', sonrasi === 0, `${oncesi} -> ${sonrasi}`);

    // ---------------- BLOK B ----------------
    console.log('\n\nBLOK B — C4 HEDEFI (bugun kirmizi olmasi BEKLENIR, cikis kodunu etkilemez)');

    console.log('\n B1) Yalniz user_roles: store_users satiri silindi, STORE_STAFF@A duruyor');
    await prisma.storeUser.deleteMany({ where: { userId: personel.id, storeId: A.id } });
    const b1Auth = await auth(personel);
    const b1 = await market.erisebilir(A, personel.id, b1Auth.roles);
    olc('erisebilir(Personel, A) — yalniz rol satiri var', b1, true,
      'Bugun erisim karari store_users.uyeMi() ile veriliyor; rol satiri hic okunmuyor. C4 kaynagi user_roles yapacak.');
    ok('B1 kurulumu dogru: STORE_STAFF@A hala duruyor',
      (await prisma.userRole.count({ where: { userId: personel.id, storeId: A.id } })) === 1);
    ok('B1 kurulumu dogru: store_users@A silindi',
      (await prisma.storeUser.count({ where: { userId: personel.id, storeId: A.id } })) === 0);

    console.log('\n B2) Yalniz store_users: STORE_STAFF@A silindi, uyelik satiri duruyor');
    await prisma.userRole.deleteMany({ where: { userId: personel.id, storeId: A.id } });
    await prisma.storeUser.create({ data: { storeId: A.id, userId: personel.id, isActive: true } });
    const b2Auth = await auth(personel);
    const b2 = await market.erisebilir(A, personel.id, b2Auth.roles);
    olc('erisebilir(Personel, A) — yalniz uyelik satiri var', b2, false,
      'Bugun uyelik tek basina erisim veriyor. C4 sonrasi yetki yalniz user_roles"tan okunacak; rol satiri olmayan uye erisemeyecek.');
    ok('B2 kurulumu dogru: STORE_STAFF@A silindi',
      (await prisma.userRole.count({ where: { userId: personel.id, storeId: A.id } })) === 0);
    ok('B2 kurulumu dogru: store_users@A duruyor',
      (await prisma.storeUser.count({ where: { userId: personel.id, storeId: A.id } })) === 1);
    ok('B2 de magazaRolleri BOS (rol satiri yok)', Object.keys(b2Auth.magazaRolleri).length === 0, JSON.stringify(b2Auth.magazaRolleri));

    console.log(`\n=== BLOK A — GECTI: ${gecti} | KALDI: ${kaldi} ===`);
    console.log('=== BLOK B — olcum ozeti ===');
    for (const b of blokB) {
      console.log(`  ${b.ad}: bugun=${b.bugun} -> C4 sonrasi=${b.c4Sonrasi} ${b.bugun === b.c4Sonrasi ? '(fark yok)' : '(C4 BUNU TERSINE CEVIRECEK)'}`);
    }
  } catch (e) {
    console.error('\nBETIK HATASI:', e?.message ?? e);
    kaldi++;
  } finally {
    // ---------------- TEMIZLIK ----------------
    for (const id of f.stores) await prisma.store.delete({ where: { id } }).catch(() => {});
    for (const id of f.sellers) await prisma.seller.delete({ where: { id } }).catch(() => {});
    for (const id of f.users) await prisma.user.delete({ where: { id } }).catch(() => {});
    const kalan = {
      users: await prisma.user.count({ where: { phone: { startsWith: ON } } }).catch(() => -1),
      user_roles: await prisma.userRole.count({ where: { userId: { in: f.users } } }).catch(() => -1),
      store_users: await prisma.storeUser.count({ where: { userId: { in: f.users } } }).catch(() => -1),
      stores: await prisma.store.count({ where: { id: { in: f.stores } } }).catch(() => -1),
      sellers: await prisma.seller.count({ where: { id: { in: f.sellers } } }).catch(() => -1),
    };
    console.log('\ntemizlik — kalan test satiri:', JSON.stringify(kalan), Object.values(kalan).every((v) => v === 0) ? 'TEMIZ' : 'ARTIK VAR (!)');
    await prisma.$disconnect();
    // BLOK B'nin kirmizisi cikis kodunu DUSURMEZ: yalnizca BLOK A baglayici.
    process.exit(kaldi > 0 ? 1 : 0);
  }
})();
