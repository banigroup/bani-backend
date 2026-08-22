// Test kullanicisina rol verme araci (CLI).
//
// Kullanim:
//   node scripts/test-kullanici-rol-ver.js <telefon> <ROL> [--store <uuid>] [--allow-prod] [--sil]
//
// Ornek:
//   node scripts/test-kullanici-rol-ver.js +905551112233 ADMIN
//   node scripts/test-kullanici-rol-ver.js +905551112233 STORE_CASHIER --store 8c9e...   (magaza kapsamli)
//   node scripts/test-kullanici-rol-ver.js +905551112233 ADMIN --sil
//
// NEDEN BU ARAC: rol atamasi A1'den beri user_roles tablosunda ve panelden
// verilebilmesi icin once ADMIN olan biri gerekiyor - tavuk-yumurta. Yerelde
// (ve gerektiginde onayla canlida) tek satirla bu dugumu cozer.
//
// IDEMPOTENT: once SELECT, satir varsa INSERT YAPMAZ. Ayni komut iki kez
// calistirilirsa ikinci calisma "zaten var" der ve DB'ye dokunmaz - user_roles
// uzerindeki bilesik unique (userId, role, storeId) storeId NULL iken
// NULL != NULL yuzunden mukerrer satiri ENGELLEMEZ, o yuzden kontrol kodda.
//
// PRODUCTION KILIDI: DATABASE_URL canliya isaret ediyorsa --allow-prod
// verilmeden CALISMAZ. Kaza ile canli veriye rol yazmayi onler.
const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..');

// .env'i Prisma gibi yukle (proje kokunden), ortam degiskeni varsa ona dokunma.
try {
  const env = fs.readFileSync(path.join(KOK, '.env'), 'utf8');
  env.split('\n').forEach((satir) => {
    const m = satir.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* .env yoksa ortam degiskeni beklenir */ }

const argv = process.argv.slice(2);
const bayrak = (ad) => argv.includes(ad);
const deger = (ad) => {
  const i = argv.indexOf(ad);
  return i >= 0 ? argv[i + 1] : undefined;
};
const konum = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1] === '--store'));

const telefon = konum[0];
const rol = konum[1];
const storeId = deger('--store') ?? null;
const silModu = bayrak('--sil');
const prodIzin = bayrak('--allow-prod');

if (!telefon || !rol) {
  console.error('Kullanim: node scripts/test-kullanici-rol-ver.js <telefon> <ROL> [--store <uuid>] [--allow-prod] [--sil]');
  process.exit(2);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL yok. .env dosyasi ya da ortam degiskeni gerekli.');
  process.exit(2);
}

// ---- PRODUCTION TESPITI ----
// Yerel kabul edilenler: localhost / 127.0.0.1. Digerleri (Railway proxy,
// internal domain, herhangi bir uzak host) CANLI sayilir. "Beyaz liste" yontemi
// bilerek secildi: yeni bir canli host eklendiginde kilit kendiliginden calisir,
// kara listeye eklemeyi unutmak diye bir risk kalmaz.
const YEREL = new Set(['localhost', '127.0.0.1']);
let hedefHost;
try {
  hedefHost = new URL(url).hostname;
} catch (e) {
  console.error('DATABASE_URL cozulemedi.');
  process.exit(2);
}
const canliMi = !YEREL.has(hedefHost);

if (canliMi && !prodIzin) {
  console.error(`REDDEDILDI: DATABASE_URL canliya isaret ediyor (host: ${hedefHost}).`);
  console.error('Canlida calistirmak icin --allow-prod bayragini acikca ver.');
  process.exit(1);
}
if (canliMi) {
  console.log(`!! CANLI VERITABANI (host: ${hedefHost}) — --allow-prod ile onaylandi.`);
}

const { PrismaClient, Role } = require(path.join(KOK, 'node_modules', '@prisma', 'client'));
const prisma = new PrismaClient();

(async () => {
  try {
    if (!Object.values(Role).includes(rol)) {
      console.error(`Gecersiz rol: ${rol}`);
      console.error(`Gecerli roller: ${Object.values(Role).join(', ')}`);
      process.exit(2);
    }

    const kullanici = await prisma.user.findUnique({
      where: { phone: telefon },
      select: { id: true, phone: true, name: true, surname: true, status: true },
    });
    if (!kullanici) {
      console.error(`Kullanici bulunamadi: ${telefon}`);
      process.exit(1);
    }
    console.log(`Kullanici: ${kullanici.id} | ${kullanici.phone} | durum=${kullanici.status}`);

    const mevcut = await prisma.userRole.findMany({
      where: { userId: kullanici.id },
      select: { id: true, role: true, storeId: true },
      orderBy: { role: 'asc' },
    });
    console.log('Mevcut roller:', mevcut.map((r) => `${r.role}${r.storeId ? '@' + r.storeId.slice(0, 8) : ''}`).join(', ') || '(yok)');

    const hedef = mevcut.find((r) => r.role === rol && r.storeId === storeId);

    if (silModu) {
      if (!hedef) {
        console.log(`Zaten yok, silinecek satir bulunamadi: ${rol}${storeId ? '@' + storeId : ' (platform)'}`);
        return;
      }
      await prisma.userRole.delete({ where: { id: hedef.id } });
      console.log(`SILINDI: ${rol}${storeId ? '@' + storeId : ' (platform)'} (id: ${hedef.id})`);
    } else {
      if (hedef) {
        console.log(`ZATEN VAR, dokunulmadi: ${rol}${storeId ? '@' + storeId : ' (platform)'} (id: ${hedef.id})`);
        return;
      }
      const yeni = await prisma.userRole.create({
        data: { userId: kullanici.id, role: rol, storeId },
        select: { id: true },
      });
      console.log(`EKLENDI: ${rol}${storeId ? '@' + storeId : ' (platform)'} (id: ${yeni.id})`);
    }

    const son = await prisma.userRole.findMany({
      where: { userId: kullanici.id },
      select: { role: true, storeId: true },
      orderBy: { role: 'asc' },
    });
    console.log('Son durum:', son.map((r) => `${r.role}${r.storeId ? '@' + r.storeId.slice(0, 8) : ''}`).join(', ') || '(rolsuz)');
    console.log('Not: rol okumasi her istekte DB\'den yapilir (JwtStrategy), token yenilemeye gerek yok.');
  } catch (e) {
    console.error('HATA:', e?.message ?? e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
