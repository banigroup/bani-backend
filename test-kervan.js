// Kervan katalog testi — SAF, veritabanina YAZMAZ.
// Canli API'den yalnizca GET ile mevcut slug listesini ceker (idempotentlik simulasyonu).
// Calistir: npm run build && node test-kervan.js
//
// ⚠️ TASARIM: KDV dogrulamasi "onceden olculen sayi" ile YAPILMAZ. Her ALT
// KATEGORININ dogru orani asagida BEYAN EDILIR; 113 urunun (101 katalog +
// mevcut 12) hepsi kendi kategorisinin beyan edilen oranini almak ZORUNDADIR.
// Sapma varsa test PATLAR. Onceki surum dagilimi "gecmiste olculen" degerlerle
// dogruladigi icin 14 urunluk yanlis siniflandirmayi yakalayamamisti.

const { KATALOG, urunleriDuzle } = require('./kervan-katalog');
const { kdvOraniBul, vitrinFiyatHesapla } = require('./dist/src/delivery/pricing.js');

const API = process.env.KERVAN_TEST_API || 'https://bani-backend-production.up.railway.app/api/v1';
const KOMISYON = 8n;

// ---- MALI BEYAN: alt kategori slug -> beklenen KDV orani ----
// Kaynak: kullanici onayli 2026 oranlari. Degistirmeden once mali teyit gerekir.
const BEKLENEN_ORAN = {
  // Elektronik -> %20
  'telefon-aksesuar': 20, 'bilgisayar-tablet': 20, 'tv-ses': 20,
  // Moda -> %10 (tekstil)
  'kadin-giyim': 10, 'erkek-giyim': 10, 'ayakkabi-canta': 10,
  // Ev, Yasam, Kirtasiye
  'mutfak': 20, 'ev-tekstili': 10, 'kirtasiye-ofis': 20,
  // Oto, Bahce, Yapi -> %20
  'oto-aksesuar': 20, 'bahce-yapi': 20,
  // Anne, Bebek, Oyuncak -> %20
  'bebek-bakim': 20, 'oyuncak': 20,
  // Spor, Outdoor -> %20 (ekipman; ayakkabi tekstil kalir)
  'fitness': 20, 'outdoor-kamp': 20,
  // Kozmetik -> %20
  'cilt-bakimi': 20, 'sac-vucut': 20, 'parfum-makyaj': 20,
  // Kitap istisna / hobi %20
  'kitap': 0, 'hobi-sanat': 20,
  // Yoresel & El Sanatlari
  'bakir-metal': 20, 'tekstil-dokuma': 10, 'seramik-ahsap': 20, 'taki': 20,
  'dogal-urunler': 20,
};

// Mevcut 12 urun: mutabakat sonrasi tasinacaklari alt kategori + beklenen oran
const MEVCUT_12 = [
  ['Bakır Güğüm', 'bakir-metal'], ['Bakır Tepsi', 'bakir-metal'],
  ['Bakır El İşi Cezve', 'bakir-metal'],
  ['El Dokuma Kilim', 'tekstil-dokuma'], ['El Örgüsü Yün Battaniye', 'tekstil-dokuma'],
  ['El Örgüsü Yün Çorap', 'tekstil-dokuma'], ['Kilim Desenli Yastık', 'tekstil-dokuma'],
  ['Keçe Terlik', 'tekstil-dokuma'],
  ['El Yapımı Seramik Kâse', 'seramik-ahsap'], ['Ahşap Oyma Servis Tabağı', 'seramik-ahsap'],
  ['Gümüş Telkari Kolye', 'taki'],
  ['Doğal Zeytinyağı Sabunu', 'dogal-urunler'],
];

let gecen = 0, kalan = 0;
const bekle = (ad, kosul, detay = '') => {
  if (kosul) { gecen++; console.log(`  OK    ${ad}`); }
  else { kalan++; console.log(`  HATA  ${ad}  ${detay}`); }
};
const altAdBul = (slug) => {
  for (const u of KATALOG) for (const a of u.alt) if (a.slug === slug) return a.ad;
  return null;
};

(async () => {
  const urunler = urunleriDuzle();

  console.log('=== 1) YAPI ===');
  bekle('9 ust kategori', KATALOG.length === 9, `bulunan: ${KATALOG.length}`);
  const altSayi = KATALOG.reduce((n, u) => n + u.alt.length, 0);
  bekle('25 alt kategori', altSayi === 25, `bulunan: ${altSayi}`);
  bekle('101 urun', urunler.length === 101, `bulunan: ${urunler.length}`);
  const yoresel = KATALOG.find((k) => k.slug === 'el-emegi');
  bekle("yoresel ust slug 'el-emegi' korundu", !!yoresel);
  bekle('yoresel 5 alt kategori', yoresel && yoresel.alt.length === 5);
  bekle('yoresel 2 yeni urun (9 kopya atlandi)',
    yoresel && yoresel.alt.reduce((n, a) => n + a.urunler.length, 0) === 2);
  bekle('her alt kategori icin mali beyan var',
    KATALOG.every((u) => u.alt.every((a) => BEKLENEN_ORAN[a.slug] !== undefined)),
    'beyani eksik: ' + KATALOG.flatMap((u) => u.alt).filter((a) => BEKLENEN_ORAN[a.slug] === undefined).map((a) => a.slug).join(', '));

  console.log('\n=== 2) SLUG SAGLIGI ===');
  const sluglar = urunler.map((u) => u.slug);
  bekle('katalog ici slug cakismasi yok', new Set(sluglar).size === sluglar.length);
  const bozuk = sluglar.filter((s) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s));
  bekle('tum sluglar temiz', bozuk.length === 0, bozuk.join(', '));
  const kase = urunler.find((u) => u.ad.includes('Kâse'));
  bekle("'Kâse' slug'i duzeldi", !kase || !kase.slug.includes('k-se'), kase && kase.slug);

  console.log('\n=== 3) MALI DOGRULUK: 101 KATALOG URUNU ===');
  const sapma = [];
  for (const u of urunler) {
    const bek = BEKLENEN_ORAN[u.altSlug];
    const r = kdvOraniBul(u.ad, u.altAd);
    if (r.oran !== bek) sapma.push(`${u.ad} [${u.altAd}] beklenen %${bek} alinan %${r.oran} (${r.etiket})`);
  }
  bekle('101 urunun HEPSI kategorisinin beyan edilen oranini aliyor',
    sapma.length === 0, `\n        ` + sapma.slice(0, 20).join('\n        '));

  console.log('\n=== 4) MALI DOGRULUK: MEVCUT 12 URUN (mutabakat sonrasi) ===');
  const sapma12 = [];
  for (const [ad, altSlug] of MEVCUT_12) {
    const altAd = altAdBul(altSlug);
    const bek = BEKLENEN_ORAN[altSlug];
    const r = kdvOraniBul(ad, altAd);
    if (r.oran !== bek) sapma12.push(`${ad} [${altAd}] beklenen %${bek} alinan %${r.oran} (${r.etiket})`);
  }
  bekle('mevcut 12 urun hedef kategorisinde dogru orani aliyor',
    sapma12.length === 0, `\n        ` + sapma12.join('\n        '));

  console.log('\n=== 5) DENETLENEBILIRLIK ===');
  const otoDegil = urunler.filter((u) => !kdvOraniBul(u.ad, u.altAd).otomatik);
  bekle('otomatik:false yok (tum oranlar kural ile aciklaniyor)',
    otoDegil.length === 0, `${otoDegil.length}: ` + otoDegil.slice(0, 6).map((u) => `${u.ad} [${u.altAd}]`).join(' | '));

  const dagilim = new Map();
  for (const u of urunler) { const o = kdvOraniBul(u.ad, u.altAd).oran; dagilim.set(o, (dagilim.get(o) || 0) + 1); }
  console.log('  bilgi — katalog KDV dagilimi:',
    [...dagilim].sort((a, b) => a[0] - b[0]).map(([o, n]) => `%${o}:${n}`).join('  '));

  console.log('\n=== 6) FIYAT MOTORU ===');
  const hatali = [];
  for (const u of urunler) {
    const h = vitrinFiyatHesapla(u.netKurus, u.desi, u.kg, u.model, BEKLENEN_ORAN[u.altSlug], KOMISYON);
    if (!h.ok) hatali.push(`${u.ad}: ${h.sebep}`);
    else if (h.vitrinKurus <= u.netKurus) hatali.push(`${u.ad}: vitrin <= net`);
  }
  bekle('101 urunun hepsi fiyatlanabiliyor', hatali.length === 0, hatali.slice(0, 5).join(' | '));

  console.log('\n=== 7) IDEMPOTENTLIK SIMULASYONU ===');
  const canli = new Set();
  try {
    const store = await (await fetch(`${API}/market/stores/slug/demo-carsi`)).json();
    for (let skip = 0; skip <= 2000; skip += 100) {
      const p = await (await fetch(`${API}/catalog/stores/${store.id}/products?skip=${skip}&take=100`)).json();
      p.forEach((x) => canli.add(x.slug));
      if (p.length < 100) break;
    }
    console.log(`  canli urun slug sayisi: ${canli.size}`);
  } catch { console.log('  (canli API okunamadi, bos kume ile simule ediliyor)'); }

  const gecis = (mevcut) => {
    let olusur = 0, atlanir = 0; const yeni = new Set(mevcut);
    for (const u of urunler) { if (yeni.has(u.slug)) atlanir++; else { yeni.add(u.slug); olusur++; } }
    return { olusur, atlanir, yeni };
  };
  const g1 = gecis(canli), g2 = gecis(g1.yeni);
  console.log(`  1. gecis: ${g1.olusur} olusur, ${g1.atlanir} atlanir`);
  console.log(`  2. gecis: ${g2.olusur} olusur, ${g2.atlanir} atlanir`);
  bekle('2. gecis HIC urun olusturmuyor (idempotent)', g2.olusur === 0);
  bekle('2. gecis 101 urunun tamamini atliyor', g2.atlanir === 101);

  console.log('\n' + '-'.repeat(70));
  console.log(`SONUC: ${gecen} gecti, ${kalan} kaldi`);
  process.exit(kalan === 0 ? 0 : 1);
})().catch((e) => { console.error('TEST HATASI:', e); process.exit(1); });
