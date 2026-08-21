// FAZ 1 / C1 — OKUMA KAPSAMI (platform rolleri <-> magaza rolleri ayrimi)
// Calistir: npm run build && node test-auth-kapsam.js
//
// GERCEK KODU calistirir (dist/): JwtStrategy.validate, rolleriOku, rolleriYaz,
// rolleriAyir ve UsersService.assignRoles.
// YALNIZCA YEREL DOCKER DB. Test verisi benzersiz onekle yaratilir, sonunda silinir.
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
const { rolleriOku, rolleriYaz, rolleriAyir } = require('./dist/src/common/rbac/kullanici-rolleri');
const { UsersService } = require('./dist/src/users/users.service');
const { JwtStrategy } = require('./dist/src/auth/strategies/jwt.strategy');

const prisma = new PrismaClient();
const auditKayitlari = [];
const auditCasus = { record: async (k) => { auditKayitlari.push(k); } };
const users = new UsersService(prisma, auditCasus);
const jwt = new JwtStrategy({ get: () => 'test-secret' }, prisma);

const ON = `__TEST_KAPSAM_${Date.now()}`;
let gecti = 0;
let kaldi = 0;
function ok(ad, sonuc, detay = '') {
  if (sonuc) { gecti++; console.log(`  GECTI  ${ad}${detay ? ' — ' + detay : ''}`); }
  else { kaldi++; console.log(`  KALDI  ${ad}${detay ? ' — ' + detay : ''}`); }
}
const sirala = (a) => [...a].sort().join(',');

let kullanici = null;
let magazaA = null;
let magazaB = null;

(async () => {
  try {
    // Kapsam testi icin GERCEK magaza gerekiyor (user_roles.storeId -> stores FK).
    const magazalar = await prisma.store.findMany({ take: 2, orderBy: { createdAt: 'asc' }, select: { id: true, name: true } });
    if (magazalar.length < 2) throw new Error('Yerel DB de en az 2 magaza gerekiyor (seed calismis mi?)');
    magazaA = magazalar[0];
    magazaB = magazalar[1];
    kullanici = await prisma.user.create({ data: { phone: ON.slice(0, 22), name: 'Kapsam', status: 'ACTIVE' } });
    const uid = kullanici.id;

    // ---- 1) Mevcut kullanici: A1 sonrasi davranis birebir ayni ----
    console.log('1) Platform rolleri (A1 sonrasiyla ayni olmali)');
    await rolleriYaz(prisma, uid, ['CUSTOMER', 'COURIER']);
    const auth1 = await jwt.validate({ sub: uid, phone: kullanici.phone, roles: [] });
    ok('roles platform rollerini veriyor', sirala(auth1.roles) === 'COURIER,CUSTOMER', sirala(auth1.roles));
    ok('magazaRolleri BOS', auth1.magazaRolleri && Object.keys(auth1.magazaRolleri).length === 0);
    ok('magazaRolleri alani her zaman var (undefined degil)', typeof auth1.magazaRolleri === 'object');

    // ---- 2) Magaza kapsamli satir: roles'a GIRMEMELI ----
    console.log('\n2) Magaza kapsamli satir eklendiginde');
    await prisma.userRole.create({ data: { userId: uid, role: 'MERCHANT', storeId: magazaA.id } });
    const auth2 = await jwt.validate({ sub: uid, phone: kullanici.phone, roles: [] });
    ok('roles DEGISMEDI (MERCHANT sizmadi)', sirala(auth2.roles) === 'COURIER,CUSTOMER', sirala(auth2.roles));
    ok('magazaRolleri o magazayi tasiyor', sirala(auth2.magazaRolleri[magazaA.id] || []) === 'MERCHANT');
    ok('yalnizca bir magaza anahtari var', Object.keys(auth2.magazaRolleri).length === 1);

    // Iki magaza, ayni kullanici
    await prisma.userRole.create({ data: { userId: uid, role: 'ADMIN', storeId: magazaB.id } });
    const auth3 = await jwt.validate({ sub: uid, phone: kullanici.phone, roles: [] });
    ok('ikinci magaza ayri anahtarda', Object.keys(auth3.magazaRolleri).length === 2);
    ok('B magazasinin ADMIN i platform ADMIN i YAPMIYOR', !auth3.roles.includes('ADMIN'), sirala(auth3.roles));
    ok('A ve B karismadi',
      sirala(auth3.magazaRolleri[magazaA.id]) === 'MERCHANT' && sirala(auth3.magazaRolleri[magazaB.id]) === 'ADMIN');

    // ---- 3) rolleriOku varsayilani PLATFORM ----
    console.log('\n3) rolleriOku varsayilan kapsami');
    const varsayilan = await rolleriOku(prisma, uid);
    ok('varsayilan magaza satirlarini DONDURMUYOR', sirala(varsayilan) === 'COURIER,CUSTOMER', sirala(varsayilan));
    ok('MERCHANT yok', !varsayilan.includes('MERCHANT'));
    ok('ADMIN yok', !varsayilan.includes('ADMIN'));

    // ---- 4) rolleriOku kapsamli cagri ----
    console.log('\n4) rolleriOku({ storeId })');
    const aRolleri = await rolleriOku(prisma, uid, { storeId: magazaA.id });
    const bRolleri = await rolleriOku(prisma, uid, { storeId: magazaB.id });
    ok('A magazasinin rolleri', sirala(aRolleri) === 'MERCHANT', sirala(aRolleri));
    ok('B magazasinin rolleri', sirala(bRolleri) === 'ADMIN', sirala(bRolleri));
    ok('kapsamli okuma platform rollerini KATMIYOR', !aRolleri.includes('CUSTOMER') && !bRolleri.includes('CUSTOMER'));
    const bosMagaza = await rolleriOku(prisma, uid, { storeId: kullanici.id }); // hic rol olmayan bir uuid
    ok('rol olmayan magaza icin bos dizi', bosMagaza.length === 0);

    // ---- 5) rolleriYaz magaza satirlarina DOKUNMUYOR ----
    console.log('\n5) rolleriYaz kapsam siniri');
    const magazaOnce = await prisma.userRole.count({ where: { userId: uid, storeId: { not: null } } });
    await rolleriYaz(prisma, uid, ['LOAD_CUSTOMER']);
    const magazaSonra = await prisma.userRole.count({ where: { userId: uid, storeId: { not: null } } });
    ok('magaza satir sayisi degismedi', magazaOnce === magazaSonra, `${magazaOnce} -> ${magazaSonra}`);
    const platformSonra = await rolleriOku(prisma, uid);
    ok('platform rolleri nihai duruma dondu', sirala(platformSonra) === 'LOAD_CUSTOMER', sirala(platformSonra));
    const authSonra = await jwt.validate({ sub: uid, phone: kullanici.phone, roles: [] });
    ok('magaza rolleri hala yerinde', Object.keys(authSonra.magazaRolleri).length === 2);

    // ---- 6) assignRoles audit: sahte "rol silindi" olayi uretmemeli ----
    console.log('\n6) assignRoles audit metadata');
    auditKayitlari.length = 0;
    await users.assignRoles(uid, ['CUSTOMER'], { actorId: uid, ip: '127.0.0.1' });
    const kayit = auditKayitlari[0];
    ok('audit kaydi yazildi', auditKayitlari.length === 1 && kayit.action === 'user.role.assign');
    ok('from YALNIZ platform listesi', sirala(kayit.metadata.from) === 'LOAD_CUSTOMER', JSON.stringify(kayit.metadata.from));
    ok('to YALNIZ platform listesi', sirala(kayit.metadata.to) === 'CUSTOMER', JSON.stringify(kayit.metadata.to));
    ok('from magaza rolu TASIMIYOR (sahte "silindi" olayi yok)',
      !kayit.metadata.from.includes('MERCHANT') && !kayit.metadata.from.includes('ADMIN'));
    const magazaHala = await prisma.userRole.count({ where: { userId: uid, storeId: { not: null } } });
    ok('assignRoles sonrasi magaza satirlari duruyor', magazaHala === 2, `${magazaHala} satir`);

    // ---- 7) rolleriAyir dogrudan (saf fonksiyon) ----
    console.log('\n7) rolleriAyir');
    const ayrik = rolleriAyir([
      { role: 'CUSTOMER', storeId: null },
      { role: 'CUSTOMER', storeId: null }, // mukerrer platform satiri
      { role: 'MERCHANT', storeId: 's1' },
      { role: 'MERCHANT', storeId: 's1' }, // mukerrer magaza satiri
      { role: 'COURIER', storeId: 's2' },
    ]);
    ok('platform tekillestirildi', sirala(ayrik.roles) === 'CUSTOMER');
    ok('magaza tekillestirildi', sirala(ayrik.magazaRolleri.s1) === 'MERCHANT' && ayrik.magazaRolleri.s1.length === 1);
    ok('iki magaza ayri', Object.keys(ayrik.magazaRolleri).length === 2);
    ok('bos girdi coke degil', rolleriAyir([]).roles.length === 0 && Object.keys(rolleriAyir([]).magazaRolleri).length === 0);

    console.log(`\n=== GECTI: ${gecti} | KALDI: ${kaldi} ===`);
  } catch (e) {
    console.error('\nBETIK HATASI:', e?.message ?? e);
    kaldi++;
  } finally {
    if (kullanici) {
      await prisma.user.delete({ where: { id: kullanici.id } }).catch((e) => console.error('temizlik:', e.message));
    }
    const kalan = await prisma.userRole.count({ where: { userId: kullanici?.id ?? '00000000-0000-0000-0000-000000000000' } }).catch(() => 0);
    console.log(`temizlik: kalan test rol satiri = ${kalan}`);
    await prisma.$disconnect();
    process.exit(kaldi > 0 ? 1 : 0);
  }
})();
