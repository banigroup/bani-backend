// FAZ 1 / C3 — MAGAZA KAPSAM DOGRULAMA MATRISI
// Calistir: npm run build && node test-magaza-kapsam.js
//
// GERCEK KODU calistirir (dist/): MarketService.erisebilir / assertOwner /
// sahipVeyaYonetici, JwtStrategy.validate, rolleriAyir. Mantik KOPYALANMADI.
//
// BLOK A: temel erisim davranisi.
// BLOK B: C4'un cevirdigi anahtar. C4 ONCESI bu blok KIRMIZIYDI (olcum olarak
//   tutuluyordu); C4 ile yesillendi ve artik BAGLAYICI.
// BLOK C: C4'un getirdigi uyelik<->rol senkronu (idempotans, pasiflestirme,
//   personel listesinde kapsam suzgeci).
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
    console.log('\n\nBLOK B — C4 ANAHTARI (C4 ONCESI KIRMIZIYDI, ARTIK BAGLAYICI)');

    console.log('\n B1) Yalniz user_roles: store_users satiri silindi, STORE_STAFF@A duruyor');
    await prisma.storeUser.deleteMany({ where: { userId: personel.id, storeId: A.id } });
    const b1Auth = await auth(personel);
    const b1 = await market.erisebilir(A, personel.id, b1Auth.roles);
    ok('erisebilir(Personel, A) — yalniz rol satiri var -> TRUE', b1 === true,
      `olculen ${b1}; C4 oncesi false idi (karar store_users'tan geliyordu)`);
    ok('B1 kurulumu dogru: STORE_STAFF@A hala duruyor',
      (await prisma.userRole.count({ where: { userId: personel.id, storeId: A.id } })) === 1);
    ok('B1 kurulumu dogru: store_users@A silindi',
      (await prisma.storeUser.count({ where: { userId: personel.id, storeId: A.id } })) === 0);

    console.log('\n B2) Yalniz store_users: STORE_STAFF@A silindi, uyelik satiri duruyor');
    await prisma.userRole.deleteMany({ where: { userId: personel.id, storeId: A.id } });
    await prisma.storeUser.create({ data: { storeId: A.id, userId: personel.id, isActive: true } });
    const b2Auth = await auth(personel);
    const b2 = await market.erisebilir(A, personel.id, b2Auth.roles);
    ok('erisebilir(Personel, A) — yalniz uyelik satiri var -> FALSE', b2 === false,
      `olculen ${b2}; C4 oncesi true idi (uyelik tek basina erisim veriyordu)`);
    ok('B2 kurulumu dogru: STORE_STAFF@A silindi',
      (await prisma.userRole.count({ where: { userId: personel.id, storeId: A.id } })) === 0);
    ok('B2 kurulumu dogru: store_users@A duruyor',
      (await prisma.storeUser.count({ where: { userId: personel.id, storeId: A.id } })) === 1);
    ok('B2 de magazaRolleri BOS (rol satiri yok)', Object.keys(b2Auth.magazaRolleri).length === 0, JSON.stringify(b2Auth.magazaRolleri));

    // ---------------- BLOK C ----------------
    console.log('\n\nBLOK C — UYELIK <-> ROL SENKRONU (C4 ile geldi)');

    // Kurulum: yabanci'yi A magazasina personel olarak ekleyecegiz (sahipA ile).
    const sahipAuth = await auth(sahipA);

    console.log('\n C1) personelEkle idempotan');
    await market.personelEkle(A.id, sahipA.id, sahipAuth.roles, yabanci.id);
    const ilkUyelik = await prisma.storeUser.count({ where: { userId: yabanci.id, storeId: A.id } });
    const ilkRol = await prisma.userRole.count({ where: { userId: yabanci.id, storeId: A.id } });
    ok('uyelik satiri yazildi', ilkUyelik === 1, `${ilkUyelik}`);
    ok('rol satiri AYNI islemde yazildi', ilkRol === 1, `${ilkRol}`);
    await market.personelEkle(A.id, sahipA.id, sahipAuth.roles, yabanci.id);
    ok('ikinci cagri mukerrer UYELIK uretmedi',
      (await prisma.storeUser.count({ where: { userId: yabanci.id, storeId: A.id } })) === 1);
    ok('ikinci cagri mukerrer ROL uretmedi',
      (await prisma.userRole.count({ where: { userId: yabanci.id, storeId: A.id } })) === 1);
    const yeniAuth = await auth(yabanci);
    ok('eklenen kisi artik erisebiliyor', (await market.erisebilir(A, yabanci.id, yeniAuth.roles)) === true);
    ok('platform rolleri degismedi', sirala(yeniAuth.roles) === 'CUSTOMER', sirala(yeniAuth.roles));

    console.log('\n C2) personelDurum(false) rol satirini da siliyor');
    await market.personelDurum(A.id, sahipA.id, sahipAuth.roles, yabanci.id, false);
    ok('rol satiri SILINDI', (await prisma.userRole.count({ where: { userId: yabanci.id, storeId: A.id } })) === 0);
    ok('uyelik satiri DURUYOR (pasif)',
      (await prisma.storeUser.count({ where: { userId: yabanci.id, storeId: A.id, isActive: false } })) === 1);
    const pasifAuth = await auth(yabanci);
    ok('pasiflesen kisi erisemiyor', (await market.erisebilir(A, yabanci.id, pasifAuth.roles)) === false);
    ok('"uye pasif ama rol duruyor" hali OLUSMADI',
      (await prisma.userRole.count({ where: { userId: yabanci.id, storeId: A.id } })) === 0);

    console.log('\n C3) yeniden aktiflestirme rol satirini geri yaziyor');
    await market.personelDurum(A.id, sahipA.id, sahipAuth.roles, yabanci.id, true);
    ok('rol satiri GERI GELDI', (await prisma.userRole.count({ where: { userId: yabanci.id, storeId: A.id } })) === 1);
    ok('uyelik yeniden AKTIF',
      (await prisma.storeUser.count({ where: { userId: yabanci.id, storeId: A.id, isActive: true } })) === 1);
    const geriAktif = await auth(yabanci);
    ok('erisim geri geldi', (await market.erisebilir(A, yabanci.id, geriAktif.roles)) === true);

    console.log('\n C4) personelListesi baska magazanin rolunu SIZDIRMIYOR');
    // Ayni kisiye B magazasinda da rol ver: A'nin listesinde GORUNMEMELI.
    await prisma.userRole.create({ data: { userId: yabanci.id, role: 'STORE_STAFF', storeId: B.id } });
    const liste = await market.personelListesi(A.id, sahipA.id, sahipAuth.roles);
    const kayit = liste.find((x) => x.userId === yabanci.id);
    ok('kisi listede', !!kayit);
    ok('yalnizca BU magazanin rolu goruluyor',
      kayit && kayit.user.rolAtamalari.length === 1 && kayit.user.rolAtamalari[0].role === 'STORE_STAFF',
      JSON.stringify(kayit && kayit.user.rolAtamalari));
    ok('B magazasinin rolu listeye SIZMADI',
      kayit && (await prisma.userRole.count({ where: { userId: yabanci.id, storeId: B.id } })) === 1
      && kayit.user.rolAtamalari.length === 1);
    ok('PLATFORM rolu (CUSTOMER) da listeye sizmiyor',
      kayit && !kayit.user.rolAtamalari.some((r) => r.role === 'CUSTOMER'));

    console.log(`\n=== GECTI: ${gecti} | KALDI: ${kaldi} ===`);
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
    process.exit(kaldi > 0 ? 1 : 0);
  }
})();
