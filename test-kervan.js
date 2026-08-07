// Kervan katalog testi — SAF, veritabanina YAZMAZ.
// Canli API'den yalnizca GET ile mevcut slug listesini ceker (idempotentlik simulasyonu icin).
// Calistir: npm run build && node test-kervan.js

const { KATALOG, urunleriDuzle } = require('./kervan-katalog');
const { kdvOraniBul, vitrinFiyatHesapla } = require('./dist/src/delivery/pricing.js');

const API = process.env.KERVAN_TEST_API || 'https://bani-backend-production.up.railway.app/api/v1';
const KOMISYON = 8n; // demo-carsi commissionRate=800; calisma aninda magazadan okunur

let gecen = 0, kalan = 0;
const bekle = (ad, kosul, detay = '') => {
  if (kosul) { gecen++; console.log(`  OK    ${ad}`); }
  else { kalan++; console.log(`  HATA  ${ad}  ${detay}`); }
};

(async () => {
  const urunler = urunleriDuzle();

  console.log('=== 1) YAPI ===');
  bekle('9 ust kategori', KATALOG.length === 9, `bulunan: ${KATALOG.length}`);
  const altSayi = KATALOG.reduce((n, u) => n + u.alt.length, 0);
  bekle('25 alt kategori (Dogal Urunler dahil)', altSayi === 25, `bulunan: ${altSayi}`);
  bekle('101 urun', urunler.length === 101, `bulunan: ${urunler.length}`);

  const yoresel = KATALOG.find((k) => k.slug === 'el-emegi');
  bekle("yoresel ust slug 'el-emegi' korundu", !!yoresel);
  bekle('yoresel 5 alt kategori', yoresel && yoresel.alt.length === 5, `bulunan: ${yoresel && yoresel.alt.length}`);
  const yoreselUrun = yoresel ? yoresel.alt.reduce((n, a) => n + a.urunler.length, 0) : -1;
  bekle('yoresel 2 yeni urun (kopyalar atlandi)', yoreselUrun === 2, `bulunan: ${yoreselUrun}`);
  const adlar = yoresel ? yoresel.alt.flatMap((a) => a.urunler.map((u) => u[0])) : [];
  bekle('yeni urunler: Bakir Sahan + Telkari Kupe',
    adlar.some((a) => a.includes('Sahan')) && adlar.some((a) => a.includes('Küpe')), adlar.join(' | '));

  console.log('\n=== 2) SLUG SAGLIGI ===');
  const sluglar = urunler.map((u) => u.slug);
  const tekil = new Set(sluglar);
  bekle('katalog ici slug cakismasi yok', tekil.size === sluglar.length,
    `${sluglar.length - tekil.size} tekrar`);
  const bozuk = sluglar.filter((s) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s));
  bekle('tum sluglar temiz (ascii, cift tire/bas-son tire yok)', bozuk.length === 0, bozuk.join(', '));
  const kase = urunler.find((u) => u.ad.includes('Kâse'));
  bekle("'Kâse' slug'i duzeldi (k-se degil)", !kase || !kase.slug.includes('k-se'), kase && kase.slug);

  console.log('\n=== 3) KDV TURETME (yaprak kategori adi ile) ===');
  const dagilim = new Map();
  const otoDegil = [];
  for (const u of urunler) {
    const k = kdvOraniBul(u.ad, u.altAd);
    dagilim.set(k.oran, (dagilim.get(k.oran) || 0) + 1);
    if (!k.otomatik) otoDegil.push(`${u.ad} [${u.altAd}]`);
  }
  for (const [oran, adet] of [...dagilim].sort((a, b) => a[0] - b[0])) console.log(`  %${String(oran).padStart(2)} -> ${adet} urun`);

  const hobi = urunler.filter((u) => u.altSlug === 'hobi-sanat');
  bekle('Hobi & Sanat urunleri %0 ISTISNAYA DUSMUYOR',
    hobi.every((u) => kdvOraniBul(u.ad, u.altAd).oran !== 0), 'ust kategori adi sizdirmis olabilir');
  const kitap = urunler.filter((u) => u.altSlug === 'kitap');
  bekle('Kitap urunleri %0 istisna aliyor',
    kitap.length > 0 && kitap.every((u) => kdvOraniBul(u.ad, u.altAd).oran === 0));
  const evTekstil = urunler.filter((u) => u.altSlug === 'ev-tekstili');
  bekle('Ev Tekstili urunleri %10 aliyor (yeni anahtarlar)',
    evTekstil.length > 0 && evTekstil.every((u) => kdvOraniBul(u.ad, u.altAd).oran === 10),
    evTekstil.map((u) => `${u.ad}=%${kdvOraniBul(u.ad, u.altAd).oran}`).join(', '));
  bekle('KDV dagilimi korundu (%0=5, %10=35, %20=61)',
    dagilim.get(0) === 5 && dagilim.get(10) === 35 && dagilim.get(20) === 61,
    `%0=${dagilim.get(0)} %10=${dagilim.get(10)} %20=${dagilim.get(20)}`);
  bekle('TUM urunler otomatik taniniyor (otomatik:false yok)',
    otoDegil.length === 0, `${otoDegil.length} urun: ` + otoDegil.slice(0, 6).join(' | '));

  console.log('\n=== 4) FIYAT MOTORU ===');
  const hatali = [];
  for (const u of urunler) {
    const kdv = kdvOraniBul(u.ad, u.altAd).oran;
    const h = vitrinFiyatHesapla(u.netKurus, u.desi, u.kg, u.model, kdv, KOMISYON);
    if (!h.ok) hatali.push(`${u.ad}: ${h.sebep}`);
    else if (h.vitrinKurus <= u.netKurus) hatali.push(`${u.ad}: vitrin <= net`);
  }
  bekle('101 urunun hepsi fiyatlanabiliyor', hatali.length === 0, hatali.slice(0, 5).join(' | '));

  console.log('\n=== 5) IDEMPOTENTLIK SIMULASYONU ===');
  let canliSluglar = new Set();
  try {
    const r1 = await fetch(`${API}/market/stores/slug/demo-carsi`);
    const store = await r1.json();
    for (let skip = 0; skip <= 2000; skip += 100) {
      const r = await fetch(`${API}/catalog/stores/${store.id}/products?skip=${skip}&take=100`);
      const p = await r.json();
      p.forEach((x) => canliSluglar.add(x.slug));
      if (p.length < 100) break;
    }
    console.log(`  canli urun slug sayisi: ${canliSluglar.size}`);
  } catch (e) {
    console.log('  (canli API okunamadi, bos kume ile simule ediliyor)');
  }

  // create-kervan.js karari: mevcut slug varsa ATLA, yoksa OLUSTUR
  const gecis = (mevcutSet) => {
    let olusur = 0, atlanir = 0;
    const yeni = new Set(mevcutSet);
    for (const u of urunler) {
      if (yeni.has(u.slug)) atlanir++;
      else { yeni.add(u.slug); olusur++; }
    }
    return { olusur, atlanir, yeni };
  };

  const g1 = gecis(canliSluglar);
  const g2 = gecis(g1.yeni);
  console.log(`  1. gecis: ${g1.olusur} olusur, ${g1.atlanir} atlanir`);
  console.log(`  2. gecis: ${g2.olusur} olusur, ${g2.atlanir} atlanir`);
  bekle('2. gecis HIC urun olusturmuyor (idempotent)', g2.olusur === 0, `${g2.olusur} urun olusurdu`);
  bekle('2. gecis 101 urunun tamamini atliyor', g2.atlanir === 101, `atlanan: ${g2.atlanir}`);

  console.log('\n' + '-'.repeat(70));
  console.log(`SONUC: ${gecen} gecti, ${kalan} kaldi`);
  process.exit(kalan === 0 ? 0 : 1);
})().catch((e) => { console.error('TEST HATASI:', e); process.exit(1); });
