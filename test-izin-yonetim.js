// FAZ 1 / A2 adim 2 — SUPERADMIN IZIN YONETIM UCLARI
// Calistir: npm run build && node test-izin-yonetim.js
//
// GERCEK KODU calistirir (dist/): IzinYonetimService, IzinYonetimController,
// IzinMatrisi ve PermissionsGuard. Audit GERCEK degil - cagriyi yakalayan casus.
// YALNIZCA YEREL DOCKER DB. Test degisiklikleri sonunda geri alinir.
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
const { IzinYonetimService } = require('./dist/src/superadmin/izin-yonetim.service');
const { IzinYonetimController } = require('./dist/src/superadmin/izin-yonetim.controller');

const prisma = new PrismaClient();
const matris = new IzinMatrisi(prisma);
const servis = new IzinYonetimService(prisma, matris);

// Audit casusu: kural 7 geregi kayit CONTROLLER'da yazilmali, serviste degil.
const auditKayitlari = [];
const auditCasus = { record: async (k) => { auditKayitlari.push(k); } };
const controller = new IzinYonetimController(servis, auditCasus);

const ctxUret = (user) => ({
  switchToHttp: () => ({ getRequest: () => ({ user }) }),
  getHandler: () => 'h',
  getClass: () => 'c',
});
const reflectorUret = (izinler) => ({ getAllAndOverride: () => izinler });

// Test icin CARRIER'a verilip geri alinacak izin (bugun CARRIER'da YOK).
const TEST_ROL = 'CARRIER';
const TEST_IZIN = 'audit:read';
const req = { ip: '127.0.0.1' };
const kullanici = { id: '00000000-0000-0000-0000-000000000001', roles: ['SUPER_ADMIN'] };

let gecti = 0;
let kaldi = 0;
function ok(ad, sonuc, detay = '') {
  if (sonuc) { gecti++; console.log(`  GECTI  ${ad}${detay ? ' — ' + detay : ''}`); }
  else { kaldi++; console.log(`  KALDI  ${ad}${detay ? ' — ' + detay : ''}`); }
}
async function hataAdi(fn) {
  try { await fn(); return null; } catch (e) { return e.constructor.name; }
}

(async () => {
  try {
    // ---- 1) Okuma uclari ----
    console.log('1) Listeleme');
    const izinler = await servis.izinler();
    ok('tum izinler geliyor', izinler.length === Object.values(Permission).length, `${izinler.length} izin`);
    ok('permission:manage listede', izinler.some((i) => i.key === 'permission:manage'));
    ok('aciklama alani tasiniyor', izinler.find((i) => i.key === 'permission:manage')?.description?.length > 0);

    const tamMatris = await servis.matrisOku();
    ok('matriste 12 rol var', Object.keys(tamMatris).length === 12, `${Object.keys(tamMatris).length} rol`);
    ok('izni olmayan rol de bos dizi ile geliyor', Object.values(tamMatris).every(Array.isArray));
    ok('SUPER_ADMIN matriste dolu', tamMatris.SUPER_ADMIN.includes('permission:manage'));

    const adminIzinleri = await servis.rolIzinleri('ADMIN');
    ok('rol izinleri okunuyor', adminIzinleri.length === 15 && adminIzinleri.includes('order:manage'), `${adminIzinleri.length} izin`);

    // ---- 2) Girdi dogrulama ----
    console.log('\n2) Girdi dogrulama');
    ok('gecersiz rol reddediliyor', (await hataAdi(() => servis.rolIzinleri('YOK_BOYLE'))) === 'BadRequestException');
    ok('tanimsiz izin reddediliyor', (await hataAdi(() => servis.ver('ADMIN', 'uydurma:izin'))) === 'BadRequestException');
    ok('gecersiz rolle verme reddediliyor', (await hataAdi(() => servis.ver('YOK_BOYLE', 'audit:read'))) === 'BadRequestException');

    // ---- 3) Ver / al ----
    console.log('\n3) Izin verme ve alma');
    const oncekiSayi = (await servis.rolIzinleri(TEST_ROL)).length;
    const v1 = await servis.ver(TEST_ROL, TEST_IZIN);
    ok('izin verildi', v1.degisti === true && v1.roller.includes(TEST_IZIN), `${oncekiSayi} -> ${v1.roller.length}`);
    const v2 = await servis.ver(TEST_ROL, TEST_IZIN);
    ok('ikinci verme idempotent (degisti=false)', v2.degisti === false && v2.roller.length === v1.roller.length);
    ok('DB de tek satir var', (await prisma.rolePermission.count({ where: { role: TEST_ROL, permissionKey: TEST_IZIN } })) === 1);

    // ---- 4) Onbellek ANINDA tazeleniyor mu (adim 2'nin kilit noktasi) ----
    console.log('\n4) Onbellek tazeleme');
    const tazeIzinler = await matris.izinler([TEST_ROL]);
    ok('yeni izin TTL beklemeden gorunuyor', tazeIzinler.has(TEST_IZIN));
    const guard = new PermissionsGuard(reflectorUret([Permission.AUDIT_READ]), matris);
    ok('guard yeni izinle geciriyor', (await guard.canActivate(ctxUret({ roles: [TEST_ROL] }))) === true);

    const a1 = await servis.al(TEST_ROL, TEST_IZIN);
    ok('izin geri alindi', a1.degisti === true && !a1.roller.includes(TEST_IZIN));
    const a2 = await servis.al(TEST_ROL, TEST_IZIN);
    ok('ikinci alma idempotent (degisti=false)', a2.degisti === false);
    ok('guard artik reddediyor', (await hataAdi(() => guard.canActivate(ctxUret({ roles: [TEST_ROL] })))) === 'ForbiddenException');
    ok('rol eski haline dondu', (await servis.rolIzinleri(TEST_ROL)).length === oncekiSayi);

    // ---- 5) Kilitlenme korumasi ----
    console.log('\n5) Kilitlenme korumasi');
    ok('SUPER_ADMIN den izin yonetimi ALINAMIYOR',
      (await hataAdi(() => servis.al('SUPER_ADMIN', 'permission:manage'))) === 'BadRequestException');
    ok('koruma sonrasi satir yerinde',
      (await prisma.rolePermission.count({ where: { role: 'SUPER_ADMIN', permissionKey: 'permission:manage' } })) === 1);
    const b1 = await servis.al('SUPER_ADMIN', 'audit:read'); // baska izin alinabiliyor mu
    ok('SUPER_ADMIN in DIGER izinleri alinabiliyor', b1.degisti === true);
    await servis.ver('SUPER_ADMIN', 'audit:read'); // geri koy
    ok('geri konuldu', (await servis.rolIzinleri('SUPER_ADMIN')).includes('audit:read'));

    // ---- 6) Controller ve audit (kural 7: kayit controller'da, tek) ----
    console.log('\n6) Controller ve audit');
    auditKayitlari.length = 0;
    const cVer = await controller.ver(kullanici, TEST_ROL, { permission: TEST_IZIN }, req);
    ok('controller izin veriyor', cVer.degisti === true);
    ok('grant audit kaydi yazildi', auditKayitlari.length === 1 && auditKayitlari[0].action === 'permission.grant');
    ok('audit metadata dogru', auditKayitlari[0].metadata.permission === TEST_IZIN && auditKayitlari[0].metadata.degisti === true);
    ok('audit entity Role/rol adi', auditKayitlari[0].entity === 'Role' && auditKayitlari[0].entityId === TEST_ROL);
    ok('audit actor ve ip tasiniyor', auditKayitlari[0].actorId === kullanici.id && auditKayitlari[0].ip === '127.0.0.1');

    auditKayitlari.length = 0;
    const cVer2 = await controller.ver(kullanici, TEST_ROL, { permission: TEST_IZIN }, req);
    ok('degismeyen girisim de audit e giriyor', auditKayitlari.length === 1 && auditKayitlari[0].metadata.degisti === false, `degisti=${cVer2.degisti}`);

    auditKayitlari.length = 0;
    const cAl = await controller.al(kullanici, TEST_ROL, TEST_IZIN, req);
    ok('controller izin aliyor', cAl.degisti === true);
    ok('revoke audit kaydi yazildi', auditKayitlari.length === 1 && auditKayitlari[0].action === 'permission.revoke');

    auditKayitlari.length = 0;
    const okuma = await controller.tumIzinler();
    ok('okuma ucu audit yazmiyor', auditKayitlari.length === 0 && okuma.length > 0);

    // ---- 7) Uclarin yetkisi ----
    console.log('\n7) Uc yetkisi');
    const yonetimGuard = new PermissionsGuard(reflectorUret([Permission.PERMISSION_MANAGE]), matris);
    ok('SUPER_ADMIN gecebiliyor', (await yonetimGuard.canActivate(ctxUret({ roles: ['SUPER_ADMIN'] }))) === true);
    ok('ADMIN GECEMIYOR', (await hataAdi(() => yonetimGuard.canActivate(ctxUret({ roles: ['ADMIN'] })))) === 'ForbiddenException');
    ok('MERCHANT GECEMIYOR', (await hataAdi(() => yonetimGuard.canActivate(ctxUret({ roles: ['MERCHANT'] })))) === 'ForbiddenException');

    // ---- 8) Matris testten cikarken bozulmadi mi ----
    console.log('\n8) Son durum');
    const sonSayi = await prisma.rolePermission.count();
    const sonIzin = await prisma.permission.count();
    ok('izin sayisi 29', sonIzin === 29, `${sonIzin}`);
    ok('cift sayisi 114 (test oncesiyle ayni)', sonSayi === 114, `${sonSayi}`);

    console.log(`\n=== GECTI: ${gecti} | KALDI: ${kaldi} ===`);
  } catch (e) {
    console.error('\nBETIK HATASI:', e?.message ?? e);
    kaldi++;
  } finally {
    // Temizlik: test izni her ihtimale karsi geri alinir, SUPER_ADMIN izinleri yerine konur.
    await prisma.rolePermission.deleteMany({ where: { role: TEST_ROL, permissionKey: TEST_IZIN } }).catch(() => {});
    await prisma.rolePermission.upsert({
      where: { role_permissionKey: { role: 'SUPER_ADMIN', permissionKey: 'audit:read' } },
      update: {}, create: { role: 'SUPER_ADMIN', permissionKey: 'audit:read' },
    }).catch(() => {});
    await prisma.$disconnect();
    process.exit(kaldi > 0 ? 1 : 0);
  }
})();
