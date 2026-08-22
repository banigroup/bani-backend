// KUYRUK DIKEY FILTRESI — YEREL DAVRANIS TESTI.
// Gercek KuyrukService ornegi + gercek yerel DB. sahiplen() private oldugu icin
// derlenmis siniftan bracket erisimiyle cagriliyor (JS'te private yalniz tip
// duzeyinde). Amac: filtrenin GERCEKTEN sahiplenmeyi engelledigini gostermek.
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
try {
  const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  env.split('\n').forEach((l) => {
    const m = l.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) {}
const u = new URL(process.env.DATABASE_URL || 'postgres://yok/yok');
if (!['localhost', '127.0.0.1'].includes(u.hostname)) {
  console.error('YEREL DB DEGIL — test calistirilmadi.'); process.exit(1);
}

const { PrismaClient, BusinessUnit, KuyrukDurum } = require('@prisma/client');
const prisma = new PrismaClient();

let gecti = 0, kaldi = 0;
const ok = (ad, sart) => { if (sart) { gecti++; console.log('  GECTI ', ad); } else { kaldi++; console.log('  KALDI ', ad); } };

// Servisi env'e gore taze kur (dikeyler CONSTRUCTOR'da cozuluyor).
function servisKur(envDegeri) {
  if (envDegeri === undefined) delete process.env.BANI_KUYRUK_DIKEYLER;
  else process.env.BANI_KUYRUK_DIKEYLER = envDegeri;
  delete require.cache[require.resolve('./dist/src/kuyruk/kuyruk.service.js')];
  const { KuyrukService } = require('./dist/src/kuyruk/kuyruk.service.js');
  return new KuyrukService(prisma, { smsGonder: async () => {} }, { leadOlustur: async () => {} });
}

const temizle = () => prisma.isKuyrugu.deleteMany({ where: { tip: { startsWith: '__DIKEYTEST' } } });

(async () => {
  try {
    await temizle();

    // --- 1) ekle() dikeyi GERCEKTEN yaziyor mu ---
    console.log('\n1) ekle() ucuncu parametreyi tabloya yaziyor mu');
    const s0 = servisKur(undefined);
    await s0.ekle('__DIKEYTEST_A', { n: 1 }, BusinessUnit.LOAD);
    await s0.ekle('__DIKEYTEST_B', { n: 2 }, BusinessUnit.SIGORTA);
    const yazilan = await prisma.isKuyrugu.findMany({
      where: { tip: { startsWith: '__DIKEYTEST' } }, orderBy: { tip: 'asc' },
    });
    ok('__DIKEYTEST_A -> LOAD', yazilan[0]?.businessUnit === 'LOAD');
    ok('__DIKEYTEST_B -> SIGORTA', yazilan[1]?.businessUnit === 'SIGORTA');
    ok('artik NULL dikeyle satir yazilmiyor', yazilan.every((r) => r.businessUnit !== null));

    // --- 2) env YOKKEN bugunku davranis: en eskiyi alir, dikeye bakmaz ---
    console.log('\n2) BANI_KUYRUK_DIKEYLER ayarli DEGIL -> bugunku davranis');
    await prisma.isKuyrugu.updateMany({ where: { tip: { startsWith: '__DIKEYTEST' } }, data: { durum: KuyrukDurum.BEKLIYOR } });
    const sHepsi = servisKur(undefined);
    ok('dikeyler alani undefined', sHepsi.dikeyler === undefined);
    const a1 = await sHepsi['sahiplen']();
    ok('en eski isi (LOAD) aldi', a1?.tip === '__DIKEYTEST_A');
    await prisma.isKuyrugu.update({ where: { id: a1.id }, data: { durum: KuyrukDurum.BEKLIYOR } });

    // --- 3) env=SIGORTA -> LOAD isi en eski OLSA DA alinmamali ---
    console.log('\n3) BANI_KUYRUK_DIKEYLER=SIGORTA -> yalniz SIGORTA isi alinir');
    const sSig = servisKur('SIGORTA');
    ok('dikeyler = [SIGORTA]', JSON.stringify(sSig.dikeyler) === '["SIGORTA"]');
    const a2 = await sSig['sahiplen']();
    ok('LOAD isi daha eski olmasina ragmen ATLANDI', a2?.tip === '__DIKEYTEST_B');
    ok('alinan is ISLENIYOR olarak kilitlendi', a2 && (await prisma.isKuyrugu.findUnique({ where: { id: a2.id } })).durum === 'ISLENIYOR');
    const kalanLoad = await prisma.isKuyrugu.findFirst({ where: { tip: '__DIKEYTEST_A' } });
    ok('LOAD isi hala BEKLIYOR (asili kalmadi)', kalanLoad.durum === 'BEKLIYOR');

    // --- 4) kapsamda hicbir is yoksa null doner, baskasinin isine dokunmaz ---
    console.log('\n4) kapsamda is yok -> null, digerine dokunulmaz');
    await prisma.isKuyrugu.updateMany({ where: { tip: '__DIKEYTEST_B' }, data: { durum: KuyrukDurum.TAMAM } });
    const sSig2 = servisKur('SIGORTA');
    ok('sahiplen() null dondu', (await sSig2['sahiplen']()) === null);
    ok('LOAD isi hala dokunulmamis', (await prisma.isKuyrugu.findFirst({ where: { tip: '__DIKEYTEST_A' } })).durum === 'BEKLIYOR');

    // --- 5) coklu deger + bosluk/kucuk harf toleransi ---
    console.log('\n5) coklu/normalize deger');
    const sCok = servisKur(' load , sigorta ');
    ok('" load , sigorta " -> [LOAD,SIGORTA]', JSON.stringify(sCok.dikeyler) === '["LOAD","SIGORTA"]');
    const a3 = await sCok['sahiplen']();
    ok('kapsam genisleyince LOAD isi alinabildi', a3?.tip === '__DIKEYTEST_A');

    // --- 6) KIRMIZI SENARYO: gecersiz env -> surec baslamamali ---
    console.log('\n6) KIRMIZI SENARYO — gecersiz deger sessiz gecilmemeli');
    let atti = false;
    try { servisKur('MARKET_YANLIS'); } catch (e) { atti = true; console.log('        istisna:', e.message.slice(0, 60) + '...'); }
    ok('tamamen gecersiz deger -> ISTISNA (sessiz "hepsini isle" YOK)', atti);
    const sKismi = servisKur('SIGORTA,YOKBOYLEBIRSEY');
    ok('kismen gecersiz -> gecerliler kullanilir', JSON.stringify(sKismi.dikeyler) === '["SIGORTA"]');

    console.log(`\n=== GECTI: ${gecti} | KALDI: ${kaldi} ===`);
  } catch (e) {
    console.error('HATA:', e);
    kaldi++;
  } finally {
    const silinen = await temizle();
    console.log('temizlik — silinen test satiri:', silinen.count, '| kalan is_kuyrugu:', await prisma.isKuyrugu.count());
    await prisma.$disconnect();
    process.exit(kaldi ? 1 : 0);
  }
})();
