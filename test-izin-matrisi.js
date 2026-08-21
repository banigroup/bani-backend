// FAZ 1 / A2 — IZIN MATRISI TABLODA (role_permissions)
// Calistir: npm run build && node test-izin-matrisi.js
//
// GERCEK KODU calistirir (dist/): IzinMatrisi servisi ve PermissionsGuard.
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
const { IzinMatrisi } = require('./dist/src/common/rbac/izin-matrisi.service');
const { PermissionsGuard } = require('./dist/src/common/rbac/permissions.guard');
const { Permission } = require('./dist/src/common/rbac/permissions.enum');

// ALTIN KOPYA — A2 ONCESI role-permissions.ts haritasinin birebir kaydi (kod
// silinmeden once cikarildi). Migration'in davranisi degistirmedigi bununla
// kanitlanir: tablo bu haritanin AYNISI olmali.
const ALTIN = {
  SUPER_ADMIN: ["address:read","address:write","audit:read","category:write","delivery:claim","delivery:manage","delivery:read","finance:read","finance:report:read","order:manage","order:read","order:write","payment:initiate","product:approve","product:read","product:write","store:manage:all","store:read","store:write","transaction:read","transaction:reverse","user:read","user:role:assign","user:suspend","user:write","wallet:read","wallet:topup","wallet:withdraw"],
  ADMIN: ["address:read","audit:read","category:write","delivery:manage","delivery:read","finance:report:read","order:manage","order:read","product:approve","product:read","product:write","store:manage:all","store:read","store:write","user:read"],
  CUSTOMER: ["address:read","address:write","order:read","order:write","payment:initiate","product:read","store:read","wallet:read"],
  COURIER: ["address:read","delivery:claim","delivery:manage","delivery:read","transaction:read","wallet:read"],
  MERCHANT: ["address:read","address:write","category:write","order:manage","order:read","product:read","product:write","store:read","store:write","transaction:read","wallet:read"],
  RESTAURANT: ["address:read","address:write","category:write","order:manage","order:read","product:read","product:write","store:read","store:write","transaction:read","wallet:read"],
  MARKET_OPERATOR: ["address:read","address:write","category:write","order:manage","order:read","product:read","product:write","store:read","store:write","transaction:read","wallet:read"],
  COFFEE_BRANCH: ["address:read","order:manage","order:read","product:read","product:write","store:read","transaction:read","wallet:read"],
  DICLEFUL_OPERATOR: ["address:read","delivery:read","transaction:read","user:read","wallet:read"],
  DICLEFUL_DRIVER: ["address:read","delivery:read","wallet:read"],
  LOAD_CUSTOMER: ["address:read","address:write","transaction:read","wallet:read"],
  CARRIER: ["address:read","transaction:read","wallet:read"],
};

// A2 adim 2'de BILEREK eklenen izin. Altin kopya A2 ONCESININ kaydi olarak
// dokunulmadan duruyor; beklenen matris = altin kopya + bu fark. Boylece
// "davranis degismedi" iddiasi ile "bilerek eklenen" ayri ayri gorunur kaliyor.
const ADIM2_EKLENEN = { SUPER_ADMIN: ['permission:manage'] };
// Faz 1/B1'de eklenen MAGAZA KADROSU rolleri. Bunlar altin kopyada YOK cunku
// A2 oncesinde var olmayan rollerdi; beklenen matris = altin kopya + A2 farki
// + B1 farki. STORE_STAFF bilerek listede degil: izinsiz kalan tek magaza rolu.
const B1_EKLENEN = {
  STORE_KITCHEN: ['order:manage'],
  STORE_CASHIER: ['order:manage'],
  STORE_STOCK: ['product:write'],
};
const BEKLENEN = {};
for (const rol of Object.keys(ALTIN)) BEKLENEN[rol] = [...ALTIN[rol], ...(ADIM2_EKLENEN[rol] || [])].sort();
for (const rol of Object.keys(B1_EKLENEN)) BEKLENEN[rol] = [...(BEKLENEN[rol] || []), ...B1_EKLENEN[rol]].sort();

const prisma = new PrismaClient();
let gecti = 0;
let kaldi = 0;
function ok(ad, sonuc, detay = '') {
  if (sonuc) { gecti++; console.log(`  GECTI  ${ad}${detay ? ' — ' + detay : ''}`); }
  else { kaldi++; console.log(`  KALDI  ${ad}${detay ? ' — ' + detay : ''}`); }
}

// Guard'a verilecek sahte Nest nesneleri.
const ctxUret = (user) => ({
  switchToHttp: () => ({ getRequest: () => ({ user }) }),
  getHandler: () => 'h',
  getClass: () => 'c',
});
const reflectorUret = (izinler) => ({ getAllAndOverride: () => izinler });

const TEST_IZIN = '__test:a2:izin';

(async () => {
  try {
    // ---- 1) permissions tablosu ile Permission enum ayrismamis mi ----
    console.log('1) Enum <-> tablo tutarliligi');
    const enumDegerleri = Object.values(Permission).sort();
    const tabloSatirlari = (await prisma.permission.findMany({ select: { key: true } }))
      .map((p) => p.key).filter((k) => k !== TEST_IZIN).sort();
    const enumdaOlmayan = tabloSatirlari.filter((k) => !enumDegerleri.includes(k));
    const tablodaOlmayan = enumDegerleri.filter((k) => !tabloSatirlari.includes(k));
    ok('izin sayisi ayni', enumDegerleri.length === tabloSatirlari.length, `enum ${enumDegerleri.length} / tablo ${tabloSatirlari.length}`);
    ok('tabloda enum disi izin yok', enumdaOlmayan.length === 0, enumdaOlmayan.join(', '));
    ok('enumdaki her izin tabloda var', tablodaOlmayan.length === 0, tablodaOlmayan.join(', '));

    // ---- 2) role_permissions == A2 oncesi kod haritasi ----
    console.log('\n2) Matris birebir tasindi mi (altin kopya)');
    const satirlar = await prisma.rolePermission.findMany({ select: { role: true, permissionKey: true } });
    const dbMatris = {};
    for (const s of satirlar) (dbMatris[s.role] = dbMatris[s.role] || []).push(s.permissionKey);
    for (const rol of Object.keys(BEKLENEN)) {
      const beklenen = BEKLENEN[rol];
      const gelen = [...(dbMatris[rol] || [])].sort();
      ok(`${rol} (${beklenen.length} izin)`, JSON.stringify(beklenen) === JSON.stringify(gelen),
        beklenen.length === gelen.length ? '' : `beklenen ${beklenen.length}, gelen ${gelen.length}`);
    }
    ok('tabloda fazladan rol yok', Object.keys(dbMatris).every((r) => BEKLENEN[r]),
      Object.keys(dbMatris).filter((r) => !BEKLENEN[r]).join(', '));
    ok('toplam cift sayisi', satirlar.length === Object.values(BEKLENEN).reduce((a, b) => a + b.length, 0), `${satirlar.length} satir`);
    const BEYAZ = ['product:write', 'category:write', 'order:manage'];
    const magazaRolleri = ['STORE_STAFF', 'STORE_KITCHEN', 'STORE_CASHIER', 'STORE_STOCK'];
    ok('B1: magaza rollerine beyaz liste DISI izin verilmemis',
      satirlar.filter((s) => magazaRolleri.includes(s.role)).every((s) => BEYAZ.includes(s.permissionKey)),
      satirlar.filter((s) => magazaRolleri.includes(s.role) && !BEYAZ.includes(s.permissionKey)).map((s) => `${s.role}:${s.permissionKey}`).join(', '));
    ok('B1: STORE_STAFF hicbir izin tasimiyor',
      satirlar.filter((s) => s.role === 'STORE_STAFF').length === 0);
    ok('adim 2: permission:manage YALNIZCA SUPER_ADMIN de',
      satirlar.filter((s) => s.permissionKey === 'permission:manage').map((s) => s.role).join(',') === 'SUPER_ADMIN');

    // ---- 3) IzinMatrisi servisi ----
    console.log('\n3) IzinMatrisi servisi');
    const matris = new IzinMatrisi(prisma);
    const adminIzin = await matris.izinler(['ADMIN']);
    ok('ADMIN order:manage aliyor', adminIzin.has('order:manage'));
    ok('ADMIN wallet:topup ALMIYOR', !adminIzin.has('wallet:topup'));
    const musteri = await matris.izinler(['CUSTOMER']);
    ok('CUSTOMER store:write ALMIYOR', !musteri.has('store:write'));
    const birlesim = await matris.izinler(['CUSTOMER', 'COURIER']);
    ok('coklu rol birlesiyor', birlesim.has('order:write') && birlesim.has('delivery:claim'), `${birlesim.size} izin`);
    ok('bos rol listesi bos kume', (await matris.izinler([])).size === 0);
    ok('tanimsiz rol coke degil', (await matris.izinler(['YOK_BOYLE_ROL'])).size === 0);

    // ---- 4) PermissionsGuard karari ----
    console.log('\n4) PermissionsGuard');
    const guard = new PermissionsGuard(reflectorUret([Permission.ORDER_MANAGE]), matris);
    ok('izinli rol geciyor', (await guard.canActivate(ctxUret({ roles: ['ADMIN'] }))) === true);
    let reddedildi = false;
    try { await guard.canActivate(ctxUret({ roles: ['CUSTOMER'] })); } catch (e) { reddedildi = e.constructor.name === 'ForbiddenException'; }
    ok('izinsiz rol 403 aliyor', reddedildi);
    let userYok = false;
    try { await guard.canActivate(ctxUret(undefined)); } catch (e) { userYok = e.constructor.name === 'ForbiddenException'; }
    ok('user yoksa 403', userYok);
    const serbest = new PermissionsGuard(reflectorUret(undefined), matris);
    ok('izin istemeyen uc serbest', (await serbest.canActivate(ctxUret(undefined))) === true);
    const cokluIzin = new PermissionsGuard(reflectorUret([Permission.STORE_WRITE, Permission.FINANCE_READ]), matris);
    let kismiRed = false;
    try { await cokluIzin.canActivate(ctxUret({ roles: ['MERCHANT'] })); } catch (e) { kismiRed = true; }
    ok('izinlerin TAMAMI gerekiyor (kismi yetmiyor)', kismiRed);

    // ---- 5) Onbellek ve temizle() ----
    console.log('\n5) Onbellek');
    await prisma.permission.create({ data: { key: TEST_IZIN, description: 'A2 testi' } });
    await prisma.rolePermission.create({ data: { role: 'CARRIER', permissionKey: TEST_IZIN } });
    const bayat = await matris.izinler(['CARRIER']);
    ok('TTL dolmadan eski gorunum korunuyor', !bayat.has(TEST_IZIN));
    matris.temizle();
    const taze = await matris.izinler(['CARRIER']);
    ok('temizle() sonrasi yeni izin gorunuyor', taze.has(TEST_IZIN));
    await prisma.permission.delete({ where: { key: TEST_IZIN } });
    const kalanAtama = await prisma.rolePermission.count({ where: { permissionKey: TEST_IZIN } });
    ok('izin silinince atama da gidiyor (Cascade)', kalanAtama === 0);
    matris.temizle();
    ok('silme sonrasi izin geri cekildi', !(await matris.izinler(['CARRIER'])).has(TEST_IZIN));

    console.log(`\n=== GECTI: ${gecti} | KALDI: ${kaldi} ===`);
  } catch (e) {
    console.error('\nBETIK HATASI:', e?.message ?? e);
    kaldi++;
  } finally {
    await prisma.permission.deleteMany({ where: { key: TEST_IZIN } }).catch(() => {});
    await prisma.$disconnect();
    process.exit(kaldi > 0 ? 1 : 0);
  }
})();
