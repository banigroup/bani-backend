// FAZ 1 / B1 — MAGAZA ROLU IZINLERI VE BEYAZ LISTE KESISIMI
// Calistir: npm run build && node test-beyaz-liste.js
//
// GERCEK KODU calistirir (dist/): PermissionsGuard, IzinMatrisi.
// EN KRITIK TEST: panelden bir magaza rolune BEYAZ LISTE DISI izin verilse
// bile guard'in onu reddettigi (kesisim). Bu, "kapsamsiz birlestirme"
// tasariminin tek panzehiri.
//
// YALNIZCA YEREL DOCKER DB. Test satirlari sonunda geri alinir.
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

const { PrismaClient, Role } = require('@prisma/client');
const { IzinMatrisi } = require('./dist/src/common/rbac/izin-matrisi.service');
const { PermissionsGuard, MAGAZA_ROLU_IZIN_BEYAZ_LISTESI } = require('./dist/src/common/rbac/permissions.guard');
const { Permission } = require('./dist/src/common/rbac/permissions.enum');

const prisma = new PrismaClient();
const matris = new IzinMatrisi(prisma);

let gecti = 0;
let kaldi = 0;
function ok(ad, sonuc, detay = '') {
  if (sonuc) { gecti++; console.log(`  GECTI  ${ad}${detay ? ' — ' + detay : ''}`); }
  else { kaldi++; console.log(`  KALDI  ${ad}${detay ? ' — ' + detay : ''}`); }
}
const ctxUret = (user) => ({
  switchToHttp: () => ({ getRequest: () => ({ user }) }),
  getHandler: () => 'h',
  getClass: () => 'c',
});
const guardUret = (izinler) => new PermissionsGuard({ getAllAndOverride: () => izinler }, matris);
async function gecerMi(guard, user) {
  try { return (await guard.canActivate(ctxUret(user))) === true; } catch (e) { return false; }
}
const MAGAZA = '11111111-1111-1111-1111-111111111111';

(async () => {
  try {
    // ---- 1) Enum ve izin satirlari ----
    console.log('1) Roller ve izinleri');
    const enumlar = await prisma.$queryRawUnsafe(
      `SELECT e.enumlabel AS d FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'Role'`
    );
    const adlar = enumlar.map((x) => x.d);
    ok('STORE_KITCHEN enum"da', adlar.includes('STORE_KITCHEN'));
    ok('STORE_CASHIER enum"da', adlar.includes('STORE_CASHIER'));
    ok('STORE_STOCK enum"da', adlar.includes('STORE_STOCK'));
    ok('toplam 16 rol', adlar.length === 16, `${adlar.length}`);

    const izinleri = async (rol) => [...(await matris.izinler([rol]))].sort();
    ok('STORE_KITCHEN -> order:manage', JSON.stringify(await izinleri('STORE_KITCHEN')) === '["order:manage"]', JSON.stringify(await izinleri('STORE_KITCHEN')));
    ok('STORE_CASHIER -> order:manage', JSON.stringify(await izinleri('STORE_CASHIER')) === '["order:manage"]');
    ok('STORE_STOCK -> product:write', JSON.stringify(await izinleri('STORE_STOCK')) === '["product:write"]');
    ok('STORE_STAFF hala IZINSIZ', (await matris.izinler(['STORE_STAFF'])).size === 0);

    const listeDisi = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM role_permissions
       WHERE role IN ('STORE_STAFF','STORE_KITCHEN','STORE_CASHIER','STORE_STOCK')
         AND "permissionKey" NOT IN ('product:write','category:write','order:manage')`
    );
    ok('DB de magaza rollerine beyaz liste disi izin YOK', listeDisi[0].n === 0);
    ok('beyaz liste tam olarak uc izin', MAGAZA_ROLU_IZIN_BEYAZ_LISTESI.size === 3, `${MAGAZA_ROLU_IZIN_BEYAZ_LISTESI.size}`);

    // ---- 2) Guard: magaza rolu beyaz listedeki izni GECIRIYOR ----
    console.log('\n2) Beyaz listedeki izin magaza rolunden geciyor');
    const siparisGuard = guardUret([Permission.ORDER_MANAGE]);
    ok('STORE_KITCHEN -> order:manage GECER',
      await gecerMi(siparisGuard, { roles: ['CUSTOMER'], magazaRolleri: { [MAGAZA]: ['STORE_KITCHEN'] } }));
    const urunGuard = guardUret([Permission.PRODUCT_WRITE]);
    ok('STORE_STOCK -> product:write GECER',
      await gecerMi(urunGuard, { roles: ['CUSTOMER'], magazaRolleri: { [MAGAZA]: ['STORE_STOCK'] } }));
    ok('STORE_KITCHEN -> product:write GECMEZ (izni yok)',
      !(await gecerMi(urunGuard, { roles: ['CUSTOMER'], magazaRolleri: { [MAGAZA]: ['STORE_KITCHEN'] } })));
    ok('STORE_STAFF -> order:manage GECMEZ (izinsiz rol)',
      !(await gecerMi(siparisGuard, { roles: ['CUSTOMER'], magazaRolleri: { [MAGAZA]: ['STORE_STAFF'] } })));
    ok('magaza rolu YOKKEN CUSTOMER gecmez',
      !(await gecerMi(siparisGuard, { roles: ['CUSTOMER'], magazaRolleri: {} })));

    // ---- 3) KESISIM TESTI — B0/5.4 itirazinin panzehiri ----
    console.log('\n3) KESISIM: panelden verilen beyaz liste DISI izin guard"dan GECMEZ');
    const kullaniciGuard = guardUret([Permission.USER_READ]);
    ok('once: STORE_KITCHEN -> user:read GECMIYOR',
      !(await gecerMi(kullaniciGuard, { roles: ['CUSTOMER'], magazaRolleri: { [MAGAZA]: ['STORE_KITCHEN'] } })));

    // PANELDEN YAPILAN HATAYI TAKLIT ET: role_permissions'a user:read yaz.
    await prisma.rolePermission.create({ data: { role: 'STORE_KITCHEN', permissionKey: 'user:read' } });
    matris.temizle();
    const hataliIzinler = await matris.izinler(['STORE_KITCHEN']);
    ok('matris user:read"i GERCEKTEN veriyor (hata yazildi)', hataliIzinler.has('user:read'), `${[...hataliIzinler].sort().join(',')}`);
    ok('GUARD YINE DE REDDEDIYOR (kesisim calisti)',
      !(await gecerMi(kullaniciGuard, { roles: ['CUSTOMER'], magazaRolleri: { [MAGAZA]: ['STORE_KITCHEN'] } })));
    ok('ayni hatali rol beyaz listedeki izni vermeye DEVAM ediyor',
      await gecerMi(siparisGuard, { roles: ['CUSTOMER'], magazaRolleri: { [MAGAZA]: ['STORE_KITCHEN'] } }));

    // Ayni izin PLATFORM rolunden gelirse gecmeli: kesisim yalnizca magaza
    // rollerine uygulanir, platform tarafi A2'deki gibi calismaya devam eder.
    ok('PLATFORM rolunden gelen user:read normal calisiyor (ADMIN)',
      await gecerMi(kullaniciGuard, { roles: ['ADMIN'], magazaRolleri: {} }));

    await prisma.rolePermission.deleteMany({ where: { role: 'STORE_KITCHEN', permissionKey: 'user:read' } });
    matris.temizle();
    ok('hatali satir geri alindi', !(await matris.izinler(['STORE_KITCHEN'])).has('user:read'));

    // ---- 4) Platform tarafi bozulmadi ----
    console.log('\n4) Platform davranisi degismedi');
    ok('ADMIN order:manage GECER', await gecerMi(siparisGuard, { roles: ['ADMIN'], magazaRolleri: {} }));
    ok('CUSTOMER user:read GECMEZ', !(await gecerMi(kullaniciGuard, { roles: ['CUSTOMER'], magazaRolleri: {} })));
    ok('magazaRolleri ALANI YOKKEN cokme yok (eski token bicimi)',
      !(await gecerMi(siparisGuard, { roles: ['CUSTOMER'] })));
    ok('user hic yokken 403', !(await gecerMi(siparisGuard, undefined)));
    const serbest = guardUret(undefined);
    ok('izin istemeyen uc serbest', await gecerMi(serbest, undefined));

    // ---- 5) Coklu magaza ve birlesim ----
    console.log('\n5) Coklu magaza');
    const cokluUser = { roles: ['CUSTOMER'], magazaRolleri: { [MAGAZA]: ['STORE_KITCHEN'], '22222222-2222-2222-2222-222222222222': ['STORE_STOCK'] } };
    ok('A"da mutfak + B"de depo -> order:manage GECER', await gecerMi(siparisGuard, cokluUser));
    ok('A"da mutfak + B"de depo -> product:write GECER', await gecerMi(urunGuard, cokluUser));
    ok('ikisi birlikte bile user:read GECMEZ', !(await gecerMi(kullaniciGuard, cokluUser)));
    const ikiIzinGuard = guardUret([Permission.ORDER_MANAGE, Permission.PRODUCT_WRITE]);
    ok('iki izin birden isteniyorsa iki magaza rolu birlesiyor', await gecerMi(ikiIzinGuard, cokluUser));

    console.log(`\n=== GECTI: ${gecti} | KALDI: ${kaldi} ===`);
  } catch (e) {
    console.error('\nBETIK HATASI:', e?.message ?? e);
    kaldi++;
  } finally {
    await prisma.rolePermission.deleteMany({ where: { role: 'STORE_KITCHEN', permissionKey: 'user:read' } }).catch(() => {});
    const son = await prisma.rolePermission.count().catch(() => -1);
    console.log('temizlik — role_permissions:', son, '(117 olmali)');
    await prisma.$disconnect();
    process.exit(kaldi > 0 ? 1 : 0);
  }
})();
