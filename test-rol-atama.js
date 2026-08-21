// FAZ 1 / B2 — MAGAZA ROL ATAMA / ALMA UCLARI
// Calistir: npm run build && node test-rol-atama.js
//
// GERCEK KODU calistirir (dist/): MarketService.rolVer/rolAl/personelEkle/
// personelDurum, MarketController, PermissionsGuard, IzinMatrisi,
// JwtStrategy.validate. Audit GERCEK degil - cagriyi yakalayan casus.
// YALNIZCA YEREL DOCKER DB. Fixture'lar benzersiz onekle, sonunda silinir.
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
const { MarketService, ATANABILIR_MAGAZA_ROLLERI } = require('./dist/src/market/market.service');
const { MarketController } = require('./dist/src/market/market.controller');
const { IzinMatrisi } = require('./dist/src/common/rbac/izin-matrisi.service');
const { PermissionsGuard } = require('./dist/src/common/rbac/permissions.guard');
const { Permission } = require('./dist/src/common/rbac/permissions.enum');
const { JwtStrategy } = require('./dist/src/auth/strategies/jwt.strategy');

const prisma = new PrismaClient();
const auditKayitlari = [];
const auditCasus = { record: async (k) => { auditKayitlari.push(k); } };
const market = new MarketService(prisma, auditCasus, {});
const controller = new MarketController(market, auditCasus);
const matris = new IzinMatrisi(prisma);
const jwt = new JwtStrategy({ get: () => 'test-secret' }, prisma);

const ON = `__TEST_B2_${Date.now()}`;
let gecti = 0;
let kaldi = 0;
function ok(ad, sonuc, detay = '') {
  if (sonuc) { gecti++; console.log(`  GECTI  ${ad}${detay ? ' — ' + detay : ''}`); }
  else { kaldi++; console.log(`  KALDI  ${ad}${detay ? ' — ' + detay : ''}`); }
}
const sirala = (a) => [...(a || [])].sort().join(',');
const ctxUret = (user) => ({
  switchToHttp: () => ({ getRequest: () => ({ user }) }),
  getHandler: () => 'h', getClass: () => 'c',
});
const guardUret = (izinler) => new PermissionsGuard({ getAllAndOverride: () => izinler }, matris);
async function gecerMi(guard, user) {
  try { return (await guard.canActivate(ctxUret(user))) === true; } catch (e) { return false; }
}
async function hataAdi(fn) {
  try { await fn(); return null; } catch (e) { return e.constructor.name; }
}
const req = { ip: '127.0.0.1' };
const f = { users: [], sellers: [], stores: [] };

async function kullaniciYarat(etiket, roller) {
  const user = await prisma.user.create({ data: { phone: `${ON}_${etiket}`, name: etiket, status: 'ACTIVE' } });
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
const auth = (user) => jwt.validate({ sub: user.id, phone: user.phone, roles: [] });
const magazaRol = (storeId, userId) =>
  prisma.userRole.findMany({ where: { userId, storeId }, select: { role: true } }).then((r) => r.map((x) => x.role).sort());

(async () => {
  let sahipA, sahipB, personel, admin, A, B;
  try {
    console.log('KURULUM');
    sahipA = await kullaniciYarat('SahipA', ['MERCHANT']);
    sahipB = await kullaniciYarat('SahipB', ['MERCHANT']);
    personel = await kullaniciYarat('Personel', ['CUSTOMER']);
    admin = await kullaniciYarat('Admin', ['ADMIN']);
    A = await magazaYarat('A', sahipA);
    B = await magazaYarat('B', sahipB);
    const sahipAuth = await auth(sahipA);
    const sahipBAuth = await auth(sahipB);
    const adminAuth = await auth(admin);
    // Personel A magazasina kadroya alinir (personelEkle: uyelik + STORE_STAFF)
    await market.personelEkle(A.id, sahipA.id, sahipAuth.roles, personel.id);
    ok('kurulum: personel A kadrosunda, STORE_STAFF yazildi',
      sirala(await magazaRol(A.id, personel.id)) === 'STORE_STAFF');

    // ---- 1) Rol ver + guard'dan gecis ----
    console.log('\n1) STORE_CASHIER ver -> guard order:manage geciriyor');
    const siparisGuard = guardUret([Permission.ORDER_MANAGE]);
    const oncesi = await auth(personel);
    ok('once: order:manage GECMIYOR', !(await gecerMi(siparisGuard, oncesi)));
    const v = await market.rolVer(A.id, sahipA.id, sahipAuth.roles, personel.id, 'STORE_CASHIER');
    ok('rolVer degisti=true', v.degisti === true, JSON.stringify(v.roller));
    ok('user_roles satiri var', sirala(await magazaRol(A.id, personel.id)) === 'STORE_CASHIER,STORE_STAFF');
    const sonrasi = await auth(personel);
    ok('magazaRolleri iki rol tasiyor', sirala(sonrasi.magazaRolleri[A.id]) === 'STORE_CASHIER,STORE_STAFF');
    ok('GUARD artik order:manage geciriyor', await gecerMi(siparisGuard, sonrasi));
    ok('platform rolleri degismedi', sirala(sonrasi.roles) === 'CUSTOMER');
    ok('beyaz liste disi izin yine gecmiyor (user:read)',
      !(await gecerMi(guardUret([Permission.USER_READ]), sonrasi)));

    // ---- 2) Idempotans ----
    console.log('\n2) Ayni rol ikinci kez');
    const v2 = await market.rolVer(A.id, sahipA.id, sahipAuth.roles, personel.id, 'STORE_CASHIER');
    ok('ikinci cagri degisti=false', v2.degisti === false);
    ok('mukerrer satir YOK',
      (await prisma.userRole.count({ where: { userId: personel.id, storeId: A.id, role: 'STORE_CASHIER' } })) === 1);

    // ---- 3) Rol beyaz listesi (KRITIK) ----
    console.log('\n3) Atanabilir rol dogrulamasi');
    for (const kotu of ['ADMIN', 'SUPER_ADMIN', 'CUSTOMER', 'MERCHANT', 'STORE_STAFF', 'UYDURMA_ROL', '']) {
      const h = await hataAdi(() => market.rolVer(A.id, sahipA.id, sahipAuth.roles, personel.id, kotu));
      ok(`'${kotu || '(bos)'}' reddedildi`, h === 'BadRequestException', h || 'REDDEDILMEDI (!)');
    }
    ok('ATANABILIR_MAGAZA_ROLLERI tam olarak uc rol', ATANABILIR_MAGAZA_ROLLERI.size === 3);
    ok('ADMIN magaza kapsamli YAZILMADI',
      (await prisma.userRole.count({ where: { userId: personel.id, storeId: A.id, role: 'ADMIN' } })) === 0);

    // ---- 4) Kapi: STORE_STAFF bu uclari cagiramaz ----
    console.log('\n4) Kapi (sahipVeyaYonetici)');
    ok('STORE_STAFF/kasiyer personel rolVer CAGIRAMAZ',
      (await hataAdi(() => market.rolVer(A.id, personel.id, sonrasi.roles, personel.id, 'STORE_STOCK'))) === 'ForbiddenException');
    ok('STORE_STAFF/kasiyer personel rolAl CAGIRAMAZ',
      (await hataAdi(() => market.rolAl(A.id, personel.id, sonrasi.roles, personel.id, 'STORE_CASHIER'))) === 'ForbiddenException');
    ok('BASKA magazanin sahibi CAGIRAMAZ',
      (await hataAdi(() => market.rolVer(A.id, sahipB.id, sahipBAuth.roles, personel.id, 'STORE_STOCK'))) === 'ForbiddenException');
    const adminVer = await market.rolVer(A.id, admin.id, adminAuth.roles, personel.id, 'STORE_STOCK');
    ok('platform ADMIN cagirabiliyor', adminVer.degisti === true);
    await market.rolAl(A.id, admin.id, adminAuth.roles, personel.id, 'STORE_STOCK');

    // ---- 5) Pasif uyeliğe rol atanamaz ----
    console.log('\n5) Uyelik sarti');
    const yabanci = await kullaniciYarat('Yabanci', ['CUSTOMER']);
    ok('kadroda OLMAYAN kisiye rol atanamaz',
      (await hataAdi(() => market.rolVer(A.id, sahipA.id, sahipAuth.roles, yabanci.id, 'STORE_CASHIER'))) === 'NotFoundException');
    await market.personelEkle(A.id, sahipA.id, sahipAuth.roles, yabanci.id);
    await market.personelDurum(A.id, sahipA.id, sahipAuth.roles, yabanci.id, false); // pasiflestir
    ok('PASIF uyeye rol atanamaz',
      (await hataAdi(() => market.rolVer(A.id, sahipA.id, sahipAuth.roles, yabanci.id, 'STORE_CASHIER'))) === 'BadRequestException');

    // ---- 6) Rol al ----
    console.log('\n6) Rol alma');
    const a1 = await market.rolAl(A.id, sahipA.id, sahipAuth.roles, personel.id, 'STORE_CASHIER');
    ok('rolAl degisti=true', a1.degisti === true);
    ok('STORE_CASHIER silindi, STORE_STAFF ETKILENMEDI',
      sirala(await magazaRol(A.id, personel.id)) === 'STORE_STAFF');
    const a2 = await market.rolAl(A.id, sahipA.id, sahipAuth.roles, personel.id, 'STORE_CASHIER');
    ok('olmayan atamada no-op (404 degil, degisti=false)', a2.degisti === false);
    ok('kisi hala kadroda (uyelik bozulmadi)',
      (await prisma.storeUser.count({ where: { userId: personel.id, storeId: A.id, isActive: true } })) === 1);
    ok('erisim STORE_STAFF uzerinden SURUYOR',
      (await market.erisebilir(A, personel.id, (await auth(personel)).roles)) === true);

    // ---- 7) ASIMETRI KARARININ KANITI ----
    console.log('\n7) personelDurum asimetrisi (kasitli karar)');
    await market.rolVer(A.id, sahipA.id, sahipAuth.roles, personel.id, 'STORE_CASHIER');
    await market.rolVer(A.id, sahipA.id, sahipAuth.roles, personel.id, 'STORE_STOCK');
    ok('uc rol birlikte var', sirala(await magazaRol(A.id, personel.id)) === 'STORE_CASHIER,STORE_STAFF,STORE_STOCK');
    await market.personelDurum(A.id, sahipA.id, sahipAuth.roles, personel.id, false);
    ok('pasiflestirme TUM rolleri sildi', (await magazaRol(A.id, personel.id)).length === 0);
    await market.personelDurum(A.id, sahipA.id, sahipAuth.roles, personel.id, true);
    ok('yeniden acma YALNIZ STORE_STAFF verdi', sirala(await magazaRol(A.id, personel.id)) === 'STORE_STAFF');
    ok('kasa/depo rolleri GERI GELMEDI (savunma derinligi)',
      !(await magazaRol(A.id, personel.id)).includes('STORE_CASHIER'));
    ok('order:manage yetkisi de geri gelmedi',
      !(await gecerMi(siparisGuard, await auth(personel))));

    // ---- 8) Iki magaza karismiyor ----
    console.log('\n8) Coklu magaza ayrisimi');
    await market.personelEkle(B.id, sahipB.id, sahipBAuth.roles, personel.id);
    await market.rolVer(A.id, sahipA.id, sahipAuth.roles, personel.id, 'STORE_CASHIER');
    await market.rolVer(B.id, sahipB.id, sahipBAuth.roles, personel.id, 'STORE_STOCK');
    const coklu = await auth(personel);
    ok('A: kasiyer + staff', sirala(coklu.magazaRolleri[A.id]) === 'STORE_CASHIER,STORE_STAFF');
    ok('B: depo + staff', sirala(coklu.magazaRolleri[B.id]) === 'STORE_STAFF,STORE_STOCK');
    ok('roller karismadi', !coklu.magazaRolleri[A.id].includes('STORE_STOCK') && !coklu.magazaRolleri[B.id].includes('STORE_CASHIER'));
    ok('A sahibi B"nin rolunu ALAMAZ',
      (await hataAdi(() => market.rolAl(B.id, sahipA.id, sahipAuth.roles, personel.id, 'STORE_STOCK'))) === 'ForbiddenException');
    ok('B"deki rol yerinde kaldi', (await magazaRol(B.id, personel.id)).includes('STORE_STOCK'));

    // ---- 9) Controller + audit ----
    console.log('\n9) Controller ve audit');
    auditKayitlari.length = 0;
    const cVer = await controller.rolVer(
      { id: sahipA.id, roles: sahipAuth.roles, phone: sahipA.phone }, A.id, personel.id, { role: 'STORE_KITCHEN' }, req);
    ok('controller rol veriyor', cVer.degisti === true);
    ok('grant audit yazildi', auditKayitlari.length === 1 && auditKayitlari[0].action === 'store.user.role.grant');
    ok('audit metadata tam',
      auditKayitlari[0].metadata.storeId === A.id && auditKayitlari[0].metadata.targetUserId === personel.id
      && auditKayitlari[0].metadata.role === 'STORE_KITCHEN');
    ok('audit actor ve ip', auditKayitlari[0].actorId === sahipA.id && auditKayitlari[0].ip === '127.0.0.1');
    auditKayitlari.length = 0;
    const cAl = await controller.rolAl(
      { id: sahipA.id, roles: sahipAuth.roles, phone: sahipA.phone }, A.id, personel.id, 'STORE_KITCHEN', req);
    ok('controller rol aliyor', cAl.degisti === true);
    ok('revoke audit yazildi', auditKayitlari.length === 1 && auditKayitlari[0].action === 'store.user.role.revoke');

    console.log(`\n=== GECTI: ${gecti} | KALDI: ${kaldi} ===`);
  } catch (e) {
    console.error('\nBETIK HATASI:', e?.message ?? e);
    kaldi++;
  } finally {
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
    console.log('temizlik — kalan test satiri:', JSON.stringify(kalan), Object.values(kalan).every((v) => v === 0) ? 'TEMIZ' : 'ARTIK VAR (!)');
    await prisma.$disconnect();
    process.exit(kaldi > 0 ? 1 : 0);
  }
})();
