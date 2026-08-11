-- ELLE YAZILMIS MIGRATION (SQL `prisma migrate diff` ile uretildi; migrate dev
-- etkilesimsiz ortamda calismadigi icin dosya elle olusturuldu - icerik birebir ayni).
--
-- SORUN: Store -> Product ve Store -> Category bagları Cascade iken, Store -> Order
--   Restrict'ti. Bu tutarsizlik iki ayri hataya yol aciyordu (yerelde kanitlandi):
--
--   A) Sadece kategori + urunu olan magaza SILINEBILIYORDU ve katalog (fiyat, KDV,
--      komisyon, kargo alanlariyla birlikte) sessizce cascade ile yok oluyordu.
--   B) Ayni delete, urun rastgele bir musterinin sepetindeyse 23001 ile patliyordu
--      (cart_items -> products RESTRICT'ine takilarak).
--   C) Magazanin siparisi varsa yine 23001 ile patliyordu (stores tablosunda).
--
--   Yani silmenin basarisi, silinen seyle alakasiz bir duruma (birinin sepetinde o
--   urun var mi) bagliydi; gectiginde de veri kaybi sessizdi.
--
-- COZUM: Katalog baglari da Restrict. Artik uc senaryo da ayni sekilde reddedilir -
--   ongorulebilir. Magaza kapatmanin yolu soft delete (stores.deletedAt; okumalar
--   zaten deletedAt: null suzuyor). Urun icin soft delete halihazirda uygulanmis
--   durumda (catalog.service: deletedAt + isActive=false).
--   Ayni ilke: 20260811085033 (yuk/arac teklifi) ve 20260811093000 (ev teklifi).
--
-- VERIYE ETKISI: YOK. Sadece FK kisitlari yeniden tanimlanir; ALTER COLUMN / UPDATE /
--   DELETE yok. Kodda store.delete / product.delete / category.delete cagiran bir yol
--   YOK (src + prisma scriptleri tarandi), dolayisiyla bu kural ileriye donuk korumadir.
--   Migration oncesi hem yerelde hem CANLIDA dogrulandi: oksuz product = 0,
--   oksuz category = 0 (canli: 5 magaza / 54 kategori / 319 urun / 20 sepet / 24 siparis).
--   Geri alma: ayni ifadeler RESTRICT yerine CASCADE ile.

-- DropForeignKey
ALTER TABLE "categories" DROP CONSTRAINT "categories_storeId_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_storeId_fkey";

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
