// BaniMarket Express (demo-market) baslangic katalogu — SADECE VERI, yan etkisi yok.
// 8 kategori / 130 urun karti. Varyantlar AYRI kart ("Uludag Frutti Limon 200ml").
//
// Iki script bu modulu okur:
//   - create-market-express.js      (her deploy; SAF KATKI, mevcut satira dokunmaz)
//   - mutabakat-market-express.js   (tek seferlik; MARKET_MUTABAKAT env'i ile)
//
// Urun dizisi: [ad, slug, fiyatKurus]. Fiyatlar KURUS (5000 = 50,00 TL).

const KATALOG = [
  {
    slug: 'icecekler', name: 'Su & İçecek', sira: 1, urunler: [
      ['Uludağ Frutti Limon 200ml', 'uludag-frutti-limon-200ml', 2500n],
      ['Uludağ Frutti Elma 200ml', 'uludag-frutti-elma-200ml', 2500n],
      ['Uludağ Frutti Karpuz-Çilek 200ml', 'uludag-frutti-karpuz-cilek-200ml', 2500n],
      ['Uludağ Frutti Narlı 200ml', 'uludag-frutti-narli-200ml', 2500n],
      ['Uludağ Frutti C-max Limon 200ml', 'uludag-frutti-cmax-limon-200ml', 2500n],
      ['Uludağ Frutti C-max Kivi 200ml', 'uludag-frutti-cmax-kivi-200ml', 2500n],
      ['Uludağ Frutti Extra Kavun 250ml', 'uludag-frutti-extra-kavun-250ml', 4500n],
      ['Uludağ Frutti Extra Yeşil Limon 250ml', 'uludag-frutti-extra-yesil-limon-250ml', 4500n],
      ['Uludağ Frutti Extra Mandalina 250ml', 'uludag-frutti-extra-mandalina-250ml', 4500n],
      ['Uludağ Frutti Extra Armut 250ml', 'uludag-frutti-extra-armut-250ml', 4500n],
      ['Uludağ Frutti Extra Orman Meyveli 250ml', 'uludag-frutti-extra-orman-meyveli-250ml', 4500n],
      ['Uludağ Limonata 250ml', 'uludag-limonata-250ml', 5000n],
      ['Uludağ Limonata 1L', 'uludag-limonata-1l', 6500n],
      ['Uludağ Limonata Şekersiz 1L', 'uludag-limonata-sekersiz-1l', 6500n],
      ['Uludağ Meyvelim Greyfurt 1L', 'uludag-meyvelim-greyfurt-1l', 6500n],
      ['Uludağ Meyvelim Mandalina 1L', 'uludag-meyvelim-mandalina-1l', 6500n],
      ['Uludağ Meyvelim Ananas 1L', 'uludag-meyvelim-ananas-1l', 6500n],
      ['Uludağ Meyvelim Nar 1L', 'uludag-meyvelim-nar-1l', 6500n],
      ['Uludağ Frutti Extra Orman Meyveli 1L', 'uludag-frutti-extra-orman-meyveli-1l', 6500n],
      ['Uludağ Frutti Extra Mandalina 1L', 'uludag-frutti-extra-mandalina-1l', 6500n],
      ['Uludağ Frutti Extra Yeşil Limon 1L', 'uludag-frutti-extra-yesil-limon-1l', 6500n],
      ['Uludağ Gazoz 1L', 'uludag-gazoz-1l', 6500n],
      ['Uludağ Portakallı Gazoz 1L', 'uludag-portakalli-gazoz-1l', 7500n],
      ['Uludağ Efsane Gazoz Şekersiz 1L', 'uludag-efsane-gazoz-sekersiz-1l', 6500n],
      ['Su 0,5L', 'su-05l', 1000n],
      ['Su 1,5L', 'su-15l', 2000n],
      ['Su 5L', 'su-5l', 5000n],
      ['Kola Kutu 330ml', 'kola-330ml', 4500n],
      ['Kola 1L', 'kola-1l', 6500n],
      ['Ayran 300ml', 'ayran-300ml', 2000n],
      ['Ayran 1L', 'ayran-1l', 4500n],
      ['Soğuk Çay Şeftali 330ml', 'soguk-cay-seftali-330ml', 4500n],
      ['Soğuk Çay Limon 330ml', 'soguk-cay-limon-330ml', 4500n],
      ['Maden Suyu Sade 6\'lı', 'maden-suyu-6li', 6000n],
      ['Meyve Suyu Karışık 1L', 'meyve-suyu-karisik-1l', 5500n],
      ['Meyve Suyu Şeftali 1L', 'meyve-suyu-seftali-1l', 5500n],
      ['Meyve Suyu Vişne 1L', 'meyve-suyu-visne-1l', 5500n],
    ],
  },
  {
    slug: 'sut-kahvaltilik', name: 'Süt & Kahvaltılık', sira: 2, urunler: [
      ['UHT Süt 1L (Tam Yağlı)', 'sut-1l', 4500n],
      ['Yumurta 15\'li (M)', 'yumurta-15li', 9500n],
      ['Yumurta 30\'lu', 'yumurta-30lu', 18000n],
      ['Beyaz Peynir 500g', 'beyaz-peynir-500g', 18000n],
      ['Kaşar Peyniri 400g', 'kasar-400g', 19000n],
      ['Üçgen Peynir 8\'li', 'ucgen-peynir-8li', 5500n],
      ['Siyah Zeytin 400g', 'siyah-zeytin-400g', 12000n],
      ['Yeşil Zeytin 400g', 'yesil-zeytin-400g', 11000n],
      ['Tereyağı 250g', 'tereyagi-250g', 15000n],
      ['Yoğurt 1,5kg', 'yogurt-15kg', 9500n],
      ['Süzme Yoğurt 600g', 'suzme-yogurt-600g', 7500n],
      ['Süzme Bal 450g', 'bal-suzme-450g', 22000n],
      ['Çikolatalı Fındık Kreması 350g', 'findik-kremasi-350g', 12000n],
      ['Vişne Reçeli 380g', 'recel-380g', 8500n],
      ['Çilek Reçeli 380g', 'recel-cilek-380g', 8500n],
      ['Sucuk (Kangal) 250g', 'sucuk-kangal-250g', 16000n],
      ['Salam 200g', 'salam-200g', 9000n],
    ],
  },
  {
    slug: 'temel-gida', name: 'Temel Gıda', sira: 3, urunler: [
      ['Ekmek 250g', 'ekmek', 1500n],
      ['Lavaş 5\'li', 'lavas-5li', 3500n],
      ['Makarna Burgu 500g', 'makarna-500g', 2500n],
      ['Makarna Spagetti 500g', 'makarna-spagetti-500g', 2500n],
      ['Pirinç Baldo 1kg', 'pirinc-1kg', 9000n],
      ['Bulgur Pilavlık 1kg', 'bulgur-1kg', 5500n],
      ['Un 2kg', 'un-2kg', 7000n],
      ['Toz Şeker 1kg', 'seker-1kg', 5000n],
      ['Ayçiçek Yağı 1L', 'aycicek-yagi-1l', 11500n],
      ['Zeytinyağı 500ml', 'zeytinyagi-500ml', 22000n],
      ['Domates Salçası 830g', 'salca-830g', 12000n],
      ['Çay 1kg (Dökme Siyah)', 'cay-1kg', 30000n],
      ['Türk Kahvesi 100g', 'turk-kahvesi-100g', 7500n],
      ['3\'ü 1 Arada 10\'lu', 'uculbir-arada-10lu', 8500n],
      ['Kırmızı Mercimek 1kg', 'mercimek-1kg', 7500n],
      ['Nohut 1kg', 'nohut-1kg', 8000n],
      ['Tuz 750g', 'tuz-750g', 2000n],
      ['Ton Balığı 2x160g', 'ton-baligi-2x160g', 13000n],
    ],
  },
  {
    slug: 'atistirmalik-cips', name: 'Atıştırmalık — Cips', sira: 4, urunler: [
      ['Doritos Taço Büyük Boy', 'doritos-taco-buyuk', 6000n],
      ['Doritos Nacho Büyük Boy', 'doritos-nacho-buyuk', 6000n],
      ['Doritos Hot Corn Büyük Boy', 'doritos-hot-corn-buyuk', 6000n],
      ['Lay\'s Klasik Büyük Boy', 'lays-klasik-buyuk', 6000n],
      ['Lay\'s Yoğurt-Yeşillik Büyük Boy', 'lays-yogurt-yesillik-buyuk', 6000n],
      ['Lay\'s Fırından Büyük Boy', 'lays-firindan-buyuk', 6000n],
      ['Ruffles Original Büyük Boy', 'ruffles-original-buyuk', 6000n],
      ['Ruffles Ketçap Büyük Boy', 'ruffles-ketcap-buyuk', 6000n],
      ['Pringles Original 165g', 'pringles-original-165g', 17000n],
      ['Pringles Mini', 'pringles-mini', 5000n],
      ['Cheetos Küçük Boy', 'cheetos-kucuk', 2000n],
      ['Çerezza Küçük Boy', 'cerezza-kucuk', 2500n],
      ['Çerezza Popcorn', 'cerezza-popcorn', 3000n],
    ],
  },
  {
    slug: 'atistirmalik-kuruyemis', name: 'Atıştırmalık — Kuruyemiş', sira: 5, urunler: [
      ['Çitello Antep Fıstığı 150g', 'citello-antep-fistigi-150g', 33000n],
      ['Çitello Antep Fıstığı 80g', 'citello-antep-fistigi-80g', 17500n],
      ['Çitello Kaju Fıstığı 130g', 'citello-kaju-130g', 12000n],
      ['Çitello Kavrulmuş Fındık İçi', 'citello-findik-ici', 7000n],
      ['Çitello Kavrulmuş Fındık İçi (Küçük Boy)', 'citello-findik-ici-kucuk', 6500n],
      ['Çitello Kavrulmuş Badem İçi', 'citello-badem-ici', 8000n],
      ['Çitello Tuzlu Kabak Çekirdeği', 'citello-kabak-cekirdegi', 7500n],
      ['Çitello Soslu Yer Fıstığı 80g', 'citello-soslu-yer-fistigi-80g', 4000n],
      ['Çitello Yağlı Yer Fıstığı', 'citello-yagli-yer-fistigi', 3000n],
      ['Çitello Tuzlu Yer Fıstığı', 'citello-tuzlu-yer-fistigi', 3500n],
      ['Çitello Barbekü Soslu Mısır Çerezi', 'citello-barbeku-misir-cerezi', 2000n],
      ['Çitello Tuzlu Sarı Leblebi', 'citello-sari-leblebi', 3000n],
      ['Çitello Beyaz Leblebi', 'citello-beyaz-leblebi', 3000n],
      ['Çitello Klasik Karışık Kuruyemiş', 'citello-klasik-karisik', 6500n],
      ['Çitello Özel Karışık Kuruyemiş', 'citello-ozel-karisik', 7500n],
      ['Çitello Kavrulmuş Siyah Ay Çekirdeği', 'citello-siyah-ay-cekirdegi', 4500n],
    ],
  },
  {
    slug: 'atistirmalik-biskuvi-cikolata', name: 'Atıştırmalık — Bisküvi & Çikolata', sira: 6, urunler: [
      ['Gofret (Tekli)', 'gofret', 1500n],
      ['Çikolata Kaplı Bar', 'cikolata-kapli-bar', 2000n],
      ['Sütlü Tablet Çikolata 80g', 'cikolata-80g', 5000n],
      ['Kremalı Bisküvi (İkili Paket)', 'kremali-biskuvi-2li', 3500n],
      ['Çikolatalı Bisküvi', 'cikolatali-biskuvi', 3000n],
      ['Kraker (Tuzlu, Orta Boy)', 'kraker-tuzlu', 2500n],
      ['Çubuk Kraker', 'cubuk-kraker', 2000n],
      ['Kek (Tekli, Kakaolu)', 'kek-kakaolu', 1500n],
      ['Sandviç Kek', 'sandvic-kek', 2000n],
      ['Ciklet / Şekerleme (Paket)', 'sekerleme-paket', 2500n],
    ],
  },
  {
    slug: 'temizlik', name: 'Temizlik & Ev', sira: 7, urunler: [
      ['Bulaşık Deterjanı 650ml', 'bulasik-deterjani-650ml', 6000n],
      ['Çamaşır Deterjanı Toz 4kg', 'camasir-deterjani-toz-4kg', 28000n],
      ['Sıvı Çamaşır Deterjanı 1,7L', 'camasir-deterjani-sivi-17l', 22000n],
      ['Yumuşatıcı 1,2L', 'yumusatici-12l', 9500n],
      ['Yüzey Temizleyici 1L', 'yuzey-temizleyici-1l', 7000n],
      ['Çamaşır Suyu 1L', 'camasir-suyu-1l', 4500n],
      ['Çöp Poşeti (Orta, Rulo)', 'cop-poseti-orta', 3500n],
      ['Tuvalet Kâğıdı 8\'li', 'tuvalet-kagidi-8li', 12000n],
      ['Kâğıt Havlu 6\'lı', 'kagit-havlu-6li', 13000n],
      ['Sünger 3\'lü', 'sunger-3lu', 3000n],
    ],
  },
  {
    slug: 'kisisel-bakim', name: 'Kişisel Bakım', sira: 8, urunler: [
      ['Şampuan 400ml', 'sampuan-400ml', 12000n],
      ['Duş Jeli 450ml', 'dus-jeli-450ml', 11000n],
      ['Sabun 4\'lü', 'sabun-4lu', 7000n],
      ['Diş Macunu 75ml', 'dis-macunu-75ml', 7500n],
      ['Diş Fırçası', 'dis-fircasi', 5000n],
      ['Tıraş Köpüğü 200ml', 'tiras-kopugu-200ml', 9000n],
      ['Hijyenik Ped (Standart Paket)', 'hijyenik-ped', 7500n],
      ['Islak Mendil 90\'lı', 'islak-mendil-90li', 4500n],
      ['Kolonya 400ml', 'kolonya-400ml', 8500n],
    ],
  },
];

const MAGAZA_SLUG = 'demo-market';

// .env okuma (lokal). Railway'de env zaten enjekte edilir; .env yoksa sorun degil.
function envYukle(dizin) {
  try {
    const fs = require('fs');
    const path = require('path');
    const env = fs.readFileSync(path.join(dizin, '.env'), 'utf8');
    env.split('\n').forEach((line) => {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (e) { /* Railway'de .env yok — normal */ }
}

// slug -> { ad, kurus, katSlug } duz haritasi (mutabakat scripti kullanir)
function katalogHaritasi() {
  const harita = new Map();
  for (const k of KATALOG) {
    for (const [ad, slug, kurus] of k.urunler) harita.set(slug, { ad, kurus, katSlug: k.slug });
  }
  return harita;
}

module.exports = { KATALOG, MAGAZA_SLUG, envYukle, katalogHaritasi };
