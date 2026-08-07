// Kervan (demo-carsi) genel e-ticaret katalogu — SADECE VERI, yan etkisi yok.
// kervan-katalog.json'dan URETILDI (elle duzenlenmemelidir; JSON degisirse yeniden uretin).
//
// Yapi:  ust kategori -> alt kategori -> urun
// Urun:  [ad, slug, netKurus (BigInt), desi, kg, satisModeli]
//
// ONEMLI:
//  - Fiyat NET'tir; vitrin fiyatini create-kervan.js vitrinFiyatHesapla ile kurar.
//  - KDV burada YOK: motordan (kdvOraniBul) YAPRAK kategori adiyla turetilir.
//  - Sluglar onceden hesaplandi; slugify'a 'a/i/u sapkali' harfler de eklendi
//    (repo util'i 'Kâse'yi 'k-se' yapiyordu).
//  - Yoresel & El Sanatlari (el-emegi): mevcut 12 urun ESAS. JSON'daki 9 kopya
//    ATLANDI; yalnizca gercekten yeni 2 urun burada (Bakir Sahan, Telkari Kupe).
//    Mevcut 12 urunun alt kategorilere tasinmasi mutabakat-kervan.js isidir.

const MAGAZA_SLUG = 'demo-carsi';

const KATALOG = [
  {
    slug: 'elektronik', ad: 'Elektronik', sira: 1, alt: [
    {
      slug: 'telefon-aksesuar', ad: 'Telefon & Aksesuar', sira: 1, urunler: [
      ['Kablosuz Kulaklık TWS Pro', 'kablosuz-kulaklik-tws-pro', 124900n, 1, 0.2, 'A'],
      ['20000 mAh Powerbank', '20000-mah-powerbank', 64900n, 2, 0.4, 'A'],
      ['Hızlı Şarj Adaptörü 65W', 'hizli-sarj-adaptoru-65w', 38900n, 1, 0.15, 'A'],
      ['Telefon Kılıfı Şeffaf Silikon', 'telefon-kilifi-seffaf-silikon', 8900n, 1, 0.05, 'A'],
      ['Manyetik Araç Telefon Tutucu', 'manyetik-arac-telefon-tutucu', 14900n, 1, 0.15, 'A'],
      ['Akıllı Saat Nabız Ölçer', 'akilli-saat-nabiz-olcer', 109900n, 1, 0.2, 'A'],
      ['Bluetooth Selfie Çubuğu', 'bluetooth-selfie-cubugu', 19900n, 1, 0.2, 'A'],
    ] },
    {
      slug: 'bilgisayar-tablet', ad: 'Bilgisayar & Tablet', sira: 2, urunler: [
      ['Kablosuz Mouse Sessiz Tıklama', 'kablosuz-mouse-sessiz-tiklama', 22900n, 1, 0.1, 'A'],
      ['Mekanik Klavye RGB', 'mekanik-klavye-rgb', 89900n, 3, 0.9, 'A'],
      ['USB-C Hub 7in1', 'usb-c-hub-7in1', 54900n, 1, 0.2, 'A'],
      ['Laptop Soğutucu Stand', 'laptop-sogutucu-stand', 34900n, 3, 0.8, 'A'],
      ['Webcam Full HD 1080p', 'webcam-full-hd-1080p', 44900n, 1, 0.2, 'A'],
      ['Harici SSD 500GB Taşınabilir', 'harici-ssd-500gb-tasinabilir', 129900n, 1, 0.1, 'A'],
    ] },
    {
      slug: 'tv-ses', ad: 'TV & Ses Sistemleri', sira: 3, urunler: [
      ['Bluetooth Hoparlör Su Geçirmez', 'bluetooth-hoparlor-su-gecirmez', 69900n, 2, 0.6, 'A'],
      ['Soundbar 2.0 Kanal', 'soundbar-2-0-kanal', 149900n, 5, 2.5, 'A'],
      ['HDMI Kablo 2m 4K', 'hdmi-kablo-2m-4k', 11900n, 1, 0.15, 'A'],
      ['Akıllı TV Kutusu 4K Android', 'akilli-tv-kutusu-4k-android', 74900n, 1, 0.3, 'A'],
    ] },
    ],
  },
  {
    slug: 'moda', ad: 'Moda', sira: 2, alt: [
    {
      slug: 'kadin-giyim', ad: 'Kadın Giyim', sira: 1, urunler: [
      ['Oversize Basic Tişört', 'oversize-basic-tisort', 19900n, 1, 0.2, 'A'],
      ['Yüksek Bel Kot Pantolon', 'yuksek-bel-kot-pantolon', 44900n, 2, 0.6, 'A'],
      ['Triko Kazak Bahar', 'triko-kazak-bahar', 37900n, 2, 0.5, 'A'],
      ['Şifon Bluz Desenli', 'sifon-bluz-desenli', 28900n, 1, 0.3, 'A'],
      ['Yazlık Elbise Çiçekli', 'yazlik-elbise-cicekli', 42900n, 2, 0.4, 'A'],
      ['Blazer Ceket Ofis', 'blazer-ceket-ofis', 64900n, 2, 0.7, 'A'],
    ] },
    {
      slug: 'erkek-giyim', ad: 'Erkek Giyim', sira: 2, urunler: [
      ['Slim Fit Gömlek Keten', 'slim-fit-gomlek-keten', 34900n, 1, 0.4, 'A'],
      ['Polo Yaka Tişört Pamuk', 'polo-yaka-tisort-pamuk', 22900n, 1, 0.3, 'A'],
      ['Chino Pantolon', 'chino-pantolon', 39900n, 2, 0.6, 'A'],
      ['Sweatshirt Kapüşonlu', 'sweatshirt-kapusonlu', 39900n, 2, 0.6, 'A'],
      ['Kışlık Mont Şişme', 'kislik-mont-sisme', 119900n, 4, 1.4, 'A'],
    ] },
    {
      slug: 'ayakkabi-canta', ad: 'Ayakkabı & Çanta', sira: 3, urunler: [
      ['Kadın Sneaker Günlük', 'kadin-sneaker-gunluk', 59900n, 3, 0.9, 'A'],
      ['Erkek Deri Klasik Ayakkabı', 'erkek-deri-klasik-ayakkabi', 89900n, 3, 1.1, 'A'],
      ['Sırt Çantası Laptop Bölmeli', 'sirt-cantasi-laptop-bolmeli', 44900n, 3, 0.8, 'A'],
      ['Kadın Topuklu Ayakkabı', 'kadin-topuklu-ayakkabi', 54900n, 3, 0.8, 'A'],
      ['Cüzdan Deri Erkek', 'cuzdan-deri-erkek', 29900n, 1, 0.3, 'A'],
    ] },
    ],
  },
  {
    slug: 'ev-yasam-kirtasiye', ad: 'Ev, Yaşam, Kırtasiye', sira: 3, alt: [
    {
      slug: 'mutfak', ad: 'Mutfak Gereçleri', sira: 1, urunler: [
      ['Granit Tencere Seti 7 Parça', 'granit-tencere-seti-7-parca', 129900n, 8, 4.5, 'A'],
      ['Çelik Bıçak Seti Blok', 'celik-bicak-seti-blok', 54900n, 3, 1.2, 'A'],
      ['Silikon Spatula Seti 5\'li', 'silikon-spatula-seti-5-li', 12900n, 1, 0.2, 'A'],
      ['Cam Saklama Kabı 6\'lı', 'cam-saklama-kabi-6-li', 27900n, 4, 2, 'A'],
      ['Kahve Makinesi Filtre', 'kahve-makinesi-filtre', 89900n, 4, 2.2, 'A'],
      ['Su Isıtıcı Kettle 1.7L', 'su-isitici-kettle-1-7l', 44900n, 3, 1.3, 'A'],
    ] },
    {
      slug: 'ev-tekstili', ad: 'Ev Tekstili', sira: 2, urunler: [
      ['Nevresim Takımı Çift Kişilik', 'nevresim-takimi-cift-kisilik', 44900n, 3, 1.5, 'A'],
      ['Yastık Ortopedik Visco', 'yastik-ortopedik-visco', 29900n, 3, 0.8, 'A'],
      ['Battaniye Peluş TV', 'battaniye-pelus-tv', 24900n, 3, 1.2, 'A'],
      ['Havlu Seti 4\'lü Bambu', 'havlu-seti-4-lu-bambu', 32900n, 3, 1.4, 'A'],
      ['Fon Perde Karartma 2 Kanat', 'fon-perde-karartma-2-kanat', 44900n, 4, 1.6, 'A'],
    ] },
    {
      slug: 'kirtasiye-ofis', ad: 'Kırtasiye & Ofis', sira: 3, urunler: [
      ['Defter Seti Noktalı 3\'lü', 'defter-seti-noktali-3-lu', 9900n, 1, 0.4, 'A'],
      ['Jel Kalem 12\'li Renkli', 'jel-kalem-12-li-renkli', 7900n, 1, 0.2, 'A'],
      ['Masaüstü Organizer Ahşap', 'masaustu-organizer-ahsap', 18900n, 2, 0.7, 'A'],
      ['Hesap Makinesi 12 Hane', 'hesap-makinesi-12-hane', 14900n, 1, 0.3, 'A'],
    ] },
    ],
  },
  {
    slug: 'oto-bahce-yapi', ad: 'Oto, Bahçe, Yapı Market', sira: 4, alt: [
    {
      slug: 'oto-aksesuar', ad: 'Oto Aksesuar', sira: 1, urunler: [
      ['Araç İçi Telefon Şarjı Çift USB', 'arac-ici-telefon-sarji-cift-usb', 14900n, 1, 0.15, 'A'],
      ['Oto Koltuk Kılıfı Takım', 'oto-koltuk-kilifi-takim', 69900n, 5, 2.8, 'A'],
      ['Cam Suyu Konsantre 4L', 'cam-suyu-konsantre-4l', 8900n, 4, 4.2, 'A'],
      ['Araç İçi Vakumlu Süpürge', 'arac-ici-vakumlu-supurge', 49900n, 2, 1, 'A'],
      ['Yedek Silecek Takımı', 'yedek-silecek-takimi', 22900n, 1, 0.4, 'A'],
    ] },
    {
      slug: 'bahce-yapi', ad: 'Bahçe & Yapı', sira: 2, urunler: [
      ['Akülü Vidalama 12V Set', 'akulu-vidalama-12v-set', 89900n, 4, 1.8, 'A'],
      ['Bahçe Hortumu 20m Makaralı', 'bahce-hortumu-20m-makarali', 54900n, 6, 3.5, 'A'],
      ['El Aletleri Çanta Seti 40 Parça', 'el-aletleri-canta-seti-40-parca', 74900n, 6, 4, 'A'],
      ['LED Çalışma Lambası Şarjlı', 'led-calisma-lambasi-sarjli', 34900n, 2, 0.7, 'A'],
      ['Sulama Fıskiyesi Otomatik', 'sulama-fiskiyesi-otomatik', 18900n, 2, 0.5, 'A'],
    ] },
    ],
  },
  {
    slug: 'anne-bebek-oyuncak', ad: 'Anne, Bebek, Oyuncak', sira: 5, alt: [
    {
      slug: 'bebek-bakim', ad: 'Bebek Bakım', sira: 1, urunler: [
      ['Bebek Bezi 4 Numara 120\'li', 'bebek-bezi-4-numara-120-li', 44900n, 6, 4.5, 'A'],
      ['Islak Mendil 12\'li Paket', 'islak-mendil-12-li-paket', 19900n, 4, 3, 'A'],
      ['Biberon Anti-Kolik 2\'li', 'biberon-anti-kolik-2-li', 24900n, 1, 0.3, 'A'],
      ['Bebek Arabası Çift Yön', 'bebek-arabasi-cift-yon', 349900n, 25, 9, 'A'],
      ['Mama Sandalyesi Katlanır', 'mama-sandalyesi-katlanir', 129900n, 12, 5.5, 'A'],
    ] },
    {
      slug: 'oyuncak', ad: 'Oyuncak', sira: 2, urunler: [
      ['Eğitici Ahşap Blok Seti', 'egitici-ahsap-blok-seti', 34900n, 3, 1.2, 'A'],
      ['Uzaktan Kumandalı Araba', 'uzaktan-kumandali-araba', 44900n, 3, 1, 'A'],
      ['Peluş Ayı 40cm', 'pelus-ayi-40cm', 19900n, 3, 0.5, 'A'],
      ['Puzzle 1000 Parça', 'puzzle-1000-parca', 14900n, 2, 0.6, 'A'],
      ['Lego Uyumlu Yapı Seti 500 Parça', 'lego-uyumlu-yapi-seti-500-parca', 44900n, 3, 1, 'A'],
    ] },
    ],
  },
  {
    slug: 'spor-outdoor', ad: 'Spor, Outdoor', sira: 6, alt: [
    {
      slug: 'fitness', ad: 'Fitness & Kondisyon', sira: 1, urunler: [
      ['Yoga Matı Kaymaz 6mm', 'yoga-mati-kaymaz-6mm', 22900n, 2, 1, 'A'],
      ['Dambıl Seti Ayarlanabilir 20kg', 'dambil-seti-ayarlanabilir-20kg', 129900n, 20, 20, 'A'],
      ['Direnç Bandı Seti 5\'li', 'direnc-bandi-seti-5-li', 14900n, 1, 0.4, 'A'],
      ['Koşu Bandı Katlanır', 'kosu-bandi-katlanir', 649900n, 45, 32, 'A'],
      ['Pilates Topu 65cm', 'pilates-topu-65cm', 19900n, 3, 0.8, 'A'],
    ] },
    {
      slug: 'outdoor-kamp', ad: 'Outdoor & Kamp', sira: 2, urunler: [
      ['Kamp Çadırı 4 Kişilik', 'kamp-cadiri-4-kisilik', 149900n, 8, 4.5, 'A'],
      ['Uyku Tulumu -5°C', 'uyku-tulumu-5-c', 69900n, 5, 2, 'A'],
      ['Termos Çelik 1L', 'termos-celik-1l', 34900n, 2, 0.7, 'A'],
      ['Kamp Sandalyesi Katlanır', 'kamp-sandalyesi-katlanir', 44900n, 4, 2.2, 'A'],
      ['Outdoor Sırt Çantası 50L', 'outdoor-sirt-cantasi-50l', 89900n, 5, 1.5, 'A'],
    ] },
    ],
  },
  {
    slug: 'kozmetik-kisisel-bakim', ad: 'Kozmetik, Kişisel Bakım', sira: 7, alt: [
    {
      slug: 'cilt-bakimi', ad: 'Cilt Bakımı', sira: 1, urunler: [
      ['Yüz Nemlendirici SPF30', 'yuz-nemlendirici-spf30', 24900n, 1, 0.2, 'A'],
      ['C Vitamini Serum 30ml', 'c-vitamini-serum-30ml', 32900n, 1, 0.15, 'A'],
      ['Temizleme Jeli 200ml', 'temizleme-jeli-200ml', 14900n, 1, 0.25, 'A'],
      ['Göz Kremi Yaşlanma Karşıtı', 'goz-kremi-yaslanma-karsiti', 27900n, 1, 0.1, 'A'],
    ] },
    {
      slug: 'sac-vucut', ad: 'Saç & Vücut Bakımı', sira: 2, urunler: [
      ['Şampuan Onarıcı 500ml', 'sampuan-onarici-500ml', 12900n, 1, 0.6, 'A'],
      ['Saç Kurutma Makinesi 2200W', 'sac-kurutma-makinesi-2200w', 54900n, 3, 0.9, 'A'],
      ['Duş Jeli Set 3\'lü', 'dus-jeli-set-3-lu', 15900n, 2, 1.2, 'A'],
      ['Saç Düzleştirici Seramik', 'sac-duzlestirici-seramik', 64900n, 2, 0.6, 'A'],
      ['Tıraş Makinesi Şarjlı', 'tiras-makinesi-sarjli', 54900n, 2, 0.5, 'A'],
    ] },
    {
      slug: 'parfum-makyaj', ad: 'Parfüm & Makyaj', sira: 3, urunler: [
      ['EDP Parfüm Kadın 100ml', 'edp-parfum-kadin-100ml', 69900n, 1, 0.4, 'A'],
      ['Likit Fondöten SPF', 'likit-fondoten-spf', 22900n, 1, 0.1, 'A'],
    ] },
    ],
  },
  {
    slug: 'kitap-muzik-film-hobi', ad: 'Kitap, Müzik, Film, Hobi', sira: 8, alt: [
    {
      slug: 'kitap', ad: 'Kitap', sira: 1, urunler: [
      ['Roman - Çok Satan Kurgu', 'roman-cok-satan-kurgu', 14900n, 1, 0.4, 'A'],
      ['Kişisel Gelişim Kitabı', 'kisisel-gelisim-kitabi', 12900n, 1, 0.35, 'A'],
      ['Çocuk Hikaye Seti 5\'li', 'cocuk-hikaye-seti-5-li', 19900n, 2, 0.9, 'A'],
      ['Ansiklopedi Görsel', 'ansiklopedi-gorsel', 24900n, 3, 1.5, 'A'],
      ['Tarih Araştırma Kitabı', 'tarih-arastirma-kitabi', 17900n, 1, 0.5, 'A'],
    ] },
    {
      slug: 'hobi-sanat', ad: 'Hobi & Sanat', sira: 2, urunler: [
      ['Akrilik Boya Seti 24 Renk', 'akrilik-boya-seti-24-renk', 22900n, 2, 0.8, 'A'],
      ['Elmas Boyama Kiti', 'elmas-boyama-kiti', 14900n, 1, 0.4, 'A'],
      ['Model Uçak Maket Kiti', 'model-ucak-maket-kiti', 29900n, 2, 0.5, 'A'],
      ['Suluboya Set 36 Renk', 'suluboya-set-36-renk', 24900n, 2, 0.7, 'A'],
      ['Örgü İpi Seti 10\'lu', 'orgu-ipi-seti-10-lu', 18900n, 2, 0.9, 'A'],
    ] },
    ],
  },
  {
    slug: 'el-emegi', ad: 'Yöresel & El Sanatları', sira: 9, alt: [
    {
      slug: 'bakir-metal', ad: 'Bakır & Metal', sira: 1, urunler: [
      ['Bakır Sahan Kalaylı', 'bakir-sahan-kalayli', 34900n, 2, 0.9, 'A'],
    ] },
    {
      slug: 'tekstil-dokuma', ad: 'Tekstil & Dokuma', sira: 2, urunler: [
    ] },
    {
      slug: 'seramik-ahsap', ad: 'Seramik & Ahşap', sira: 3, urunler: [
    ] },
    {
      slug: 'taki', ad: 'Takı', sira: 4, urunler: [
      ['Gümüş Telkari Küpe', 'gumus-telkari-kupe', 64900n, 1, 0.05, 'A'],
    ] },
    {
      slug: 'dogal-urunler', ad: 'Doğal Ürünler', sira: 5, urunler: [
    ] },
    ],
  },
];

// .env okuma (lokal). Railway'de env zaten enjekte edilir.
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

// Duz liste: [{ ustSlug, ustAd, altSlug, altAd, ad, slug, netKurus, desi, kg, model }]
function urunleriDuzle() {
  const cikti = [];
  for (const ust of KATALOG) {
    for (const alt of ust.alt) {
      for (const [ad, slug, netKurus, desi, kg, model] of alt.urunler) {
        cikti.push({
          ustSlug: ust.slug, ustAd: ust.ad, altSlug: alt.slug, altAd: alt.ad,
          ad, slug, netKurus, desi, kg, model,
        });
      }
    }
  }
  return cikti;
}

module.exports = { KATALOG, MAGAZA_SLUG, envYukle, urunleriDuzle };
