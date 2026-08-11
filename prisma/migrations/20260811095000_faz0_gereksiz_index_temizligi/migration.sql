-- ELLE YAZILMIS MIGRATION (SQL `prisma migrate diff` ile uretildi; migrate dev
-- etkilesimsiz ortamda calismadigi icin dosya elle olusturuldu - icerik birebir ayni).
--
-- Her biri BASKA bir index'in oneki oldugu icin gereksiz. Postgres'te (a, b) btree
-- index'i, yalnizca a uzerindeki sorgulari da karsilar; unique kisitlar da btree
-- index uretir. Bu 6 index yalnizca yazma maliyeti + disk tutuyordu.
--
--   users_phone_idx                    -> users_phone_key (phone @unique)
--   orders_orderNo_idx                 -> orders_orderNo_key (orderNo @unique)
--   cart_items_cartId_idx              -> cart_items_cartId_productId_key oneki
--   sozlesme_onaylari_kullaniciId_idx  -> sozlesme_onaylari_kullaniciId_sozlesmeTipi_surum_key oneki
--   yuk_ilanlari_durum_idx             -> yuk_ilanlari_durum_yuklemeTarihi_idx oneki
--   arac_ilanlari_durum_idx            -> arac_ilanlari_durum_cikisTarihi_idx oneki
--
-- DOKUNULMAYANLAR (kapsayicisi YOK, kalmali):
--   transactions_orderNo_idx  - Transaction.orderNo unique DEGIL
--   komisyon_odemeleri_durum_idx / partner_basvurulari_durum_idx /
--   sigorta_talepleri_durum_idx / sigorta_sube_basvurulari_durum_idx
--     - bu modellerde durum ile baslayan bilesik index yok
--
-- VERIYE ETKISI: YOK. Index dusurmek satir silmez/degistirmez.
--   Yerelde EXPLAIN ile dogrulandi: 6 sorgunun 4'u zaten kaldirilan index'i
--   KULLANMIYORDU (planlayici bilesik/unique index'i seciyordu); kalan 2'si de
--   dusurulunce unique index'e dustu, hicbiri seq scan'e dusmedi.
--   Geri alma: ayni adlarla CREATE INDEX (tanimlar sema gecmisinde mevcut).

-- DropIndex
DROP INDEX "arac_ilanlari_durum_idx";

-- DropIndex
DROP INDEX "cart_items_cartId_idx";

-- DropIndex
DROP INDEX "orders_orderNo_idx";

-- DropIndex
DROP INDEX "sozlesme_onaylari_kullaniciId_idx";

-- DropIndex
DROP INDEX "users_phone_idx";

-- DropIndex
DROP INDEX "yuk_ilanlari_durum_idx";
