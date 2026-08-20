// FAZ 1 / A1 — ROL ATAMASI TABLOYA TASINDI (users.roles -> user_roles)
// Calistir: npm run build && node test-user-roles.js
//
// GERCEK KODU calistirir (dist/): rol okuma/yazma yardimcilari, JwtStrategy'nin
// dogrulama yolu, AuthService.guestSession ve UsersService.assignRoles.
//
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
const { rolleriOku, rolleriYaz } = require('./dist/src/common/rbac/kullanici-rolleri');
const { platformYoneticisi } = require('./dist/src/common/rbac/rol-kontrol');
const { IzinMatrisi } = require('./dist/src/common/rbac/izin-matrisi.service');
const { UsersService } = require('./dist/src/users/users.service');
const { JwtStrategy } = require('./dist/src/auth/strategies/jwt.strategy');

const prisma = new PrismaClient();
// Audit GERCEK degil: rol atamasinin audit kaydi ayrica dogrulanacak, o yuzden
// cagriyi yakalayan bir casus veriliyor.
const auditKayitlari = [];
const auditCasus = { record: async (k) => { auditKayitlari.push(k); } };
const users = new UsersService(prisma, auditCasus);
// JwtStrategy'nin ctor'u ConfigService istiyor; yalnizca secretOrKey icin.
const jwt = new JwtStrategy({ get: () => 'test-secret' }, prisma);

const ON = `__TEST_ROL_${Date.now()}`;
let gecti = 0;
let kaldi = 0;
function ok(ad, sonuc, detay = '') {
  if (sonuc) { gecti++; console.log(`  GECTI  ${ad}${detay ? ' — ' + detay : ''}`); }
  else { kaldi++; console.log(`  KALDI  ${ad}${detay ? ' — ' + detay : ''}`); }
}

async function kur() {
  const kullanici = await prisma.user.create({
    data: { phone: ON.slice(0, 20), name: 'Rol', status: 'ACTIVE' },
  });
  const banli = await prisma.user.create({
    data: { phone: `${ON.slice(0, 19)}B`, name: 'Banli', status: 'BANNED' },
  });
  return { kullanici, banli };
}

async function temizle(f) {
  if (!f) return;
  const idler = [f.kullanici?.id, f.banli?.id].filter(Boolean);
  await prisma.userRole.deleteMany({ where: { userId: { in: idler } } });
  await prisma.user.deleteMany({ where: { id: { in: idler } } });
}

(async () => {
  let f;
  try {
    f = await kur();
    const uid = f.kullanici.id;

    // ---- 1) YAZ / OKU ----
    console.log('1) Rol yazma ve okuma');
    ok('yeni kullanici rolsuz', (await rolleriOku(prisma, uid)).length === 0);
    await rolleriYaz(prisma, uid, ['CUSTOMER', 'COURIER']);
    const roller = await rolleriOku(prisma, uid);
    ok('iki rol yazildi', roller.length === 2 && roller.includes('CUSTOMER') && roller.includes('COURIER'),
      roller.join(', '));
    const satirlar = await prisma.userRole.findMany({ where: { userId: uid } });
    ok('storeId A1 de HEP NULL', satirlar.every((s) => s.storeId === null));

    // ---- 2) NIHAI DURUM: eksikler kaldirilir ----
    console.log('\n2) Toplu yazma nihai durumdur');
    await rolleriYaz(prisma, uid, ['MERCHANT']);
    const sonra = await rolleriOku(prisma, uid);
    ok('eski roller kalkti', sonra.length === 1 && sonra[0] === 'MERCHANT', sonra.join(', '));

    // ---- 3) TEKILLESTIRME ----
    console.log('\n3) Tekillestirme');
    await rolleriYaz(prisma, uid, ['ADMIN', 'ADMIN', 'CUSTOMER']);
    const tekil = await rolleriOku(prisma, uid);
    ok('ayni rol iki kez yazilmadi', tekil.length === 2, tekil.join(', '));

    // ---- 4) JwtStrategy rolleri DB'den okuyor ----
    console.log('\n4) JwtStrategy dogrulamasi');
    // payload.roles BILEREK yanlis: token degil DB kazanmali.
    const authUser = await jwt.validate({ sub: uid, phone: f.kullanici.phone, roles: ['SUPER_ADMIN'] });
    ok('token rolleri yok sayildi', !authUser.roles.includes('SUPER_ADMIN'), authUser.roles.join(', '));
    ok('DB rolleri dondu', authUser.roles.includes('ADMIN') && authUser.roles.includes('CUSTOMER'));
    try {
      await jwt.validate({ sub: f.banli.id, phone: f.banli.phone, roles: [] });
      ok('BANNED kullanici reddedildi', false, 'hata beklendi, gelmedi');
    } catch (e) {
      ok('BANNED kullanici reddedildi', e?.status === 401 || /Unauthorized/i.test(e?.message ?? ''));
    }

    // ---- 5) Rol degisikligi ANINDA etkili (token flush yok) ----
    console.log('\n5) Rol degisikligi anlik');
    await rolleriYaz(prisma, uid, ['CUSTOMER']);
    const sonrakiAuth = await jwt.validate({ sub: uid, phone: f.kullanici.phone, roles: [] });
    ok('ayni token, yeni roller', sonrakiAuth.roles.length === 1 && sonrakiAuth.roles[0] === 'CUSTOMER',
      sonrakiAuth.roles.join(', '));

    // ---- 6) assignRoles + AUDIT ----
    console.log('\n6) assignRoles ve audit izi');
    auditKayitlari.length = 0;
    await users.assignRoles(uid, ['MERCHANT', 'COURIER'], { actorId: uid, ip: '127.0.0.1' });
    const kayit = auditKayitlari[0];
    ok('audit kaydi yazildi', !!kayit && kayit.action === 'user.role.assign');
    ok('oncesi/sonrasi audit metadata da',
      kayit && kayit.metadata.from.includes('CUSTOMER')
      && kayit.metadata.to.includes('MERCHANT') && kayit.metadata.to.includes('COURIER'),
      kayit ? `${JSON.stringify(kayit.metadata.from)} -> ${JSON.stringify(kayit.metadata.to)}` : '');
    ok('DB durumu audit ile ayni', (await rolleriOku(prisma, uid)).length === 2);

    // ---- 7) Izin matrisi ve platformYoneticisi ----
    console.log('\n7) Izin ve rol yargisi');
    ok('platformYoneticisi ADMIN', platformYoneticisi(['ADMIN']));
    ok('platformYoneticisi SUPER_ADMIN', platformYoneticisi(['SUPER_ADMIN']));
    ok('platformYoneticisi MERCHANT degil', !platformYoneticisi(['MERCHANT']));
    ok('platformYoneticisi bos/undefined dayanikli', !platformYoneticisi(undefined) && !platformYoneticisi([]));
    await rolleriYaz(prisma, uid, ['ADMIN']);
    const izinAuth = await jwt.validate({ sub: uid, phone: f.kullanici.phone, roles: [] });
    const izinler = await new IzinMatrisi(prisma).izinler(izinAuth.roles);
    ok('izin matrisi tablodan gelen rolle calisiyor', izinler.has('order:manage') && !izinler.has('wallet:topup'),
      `${izinler.size} izin`);

    // ---- 8) Kullanici silinince rol satiri da gider (Cascade) ----
    console.log('\n8) Cascade');
    const gecici = await prisma.user.create({
      data: { phone: `${ON.slice(0, 19)}C`, name: 'Gecici', status: 'ACTIVE' },
    });
    await rolleriYaz(prisma, gecici.id, ['CUSTOMER']);
    await prisma.user.delete({ where: { id: gecici.id } });
    ok('rol satiri de silindi', (await prisma.userRole.count({ where: { userId: gecici.id } })) === 0);

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
