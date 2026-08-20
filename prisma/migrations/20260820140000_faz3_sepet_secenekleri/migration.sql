-- FAZ 3 / ADIM 3 — SECENEKLERIN SEPETE VE SIPARIS SATIRINA TASINMASI
--
-- 1) cart_items tekil indeksi DUSUYOR.
--    Karar: ayni urun+varyant, FARKLI SECIM KUMESI = AYRI KALEM. Secimler ayri
--    tabloda (cart_item_options) durdugu icin tekillik anahtari artik SQL ile
--    ifade edilemez; unique kalsaydi ikinci kalem P2002 ile reddedilirdi.
--    Koruma uygulamaya tasindi (cart.service.addItem secim kumesi karsilastirmasi).
--    Yerine DUZ indeks: hem o aday aramasi hem de cartId onekiyle sepet okumasi
--    icin (eski cart_items_cartId_idx 20260811095000'de tam bu gerekceyle silinmisti).
DROP INDEX "cart_items_cartId_productId_variantId_key";
CREATE INDEX "cart_items_cartId_productId_variantId_idx" ON "cart_items"("cartId", "productId", "variantId");

-- 2) Secim satirina CARSI MUHASEBE KIRILIMI.
--    Ek ucret de tam fiyat hattindan gecer: komisyon + mal KDV + hizmet KDV
--    ayristirilir ve burada saklanir; checkout bu kolonlari siparis basligindaki
--    commission/vat/netRevenue toplamlarina ekler.
--    NULL = Carsi disi (kirilim yok) - urun/varyant tarafiyla ayni desen, bu
--    yuzden DEFAULT verilmedi: 0 ile "kirilim yok" ayirt edilebilir kalsin.
--    Mevcut satirlarda etki YOK (tablo Faz 3 adim 1'de acildi, henuz yazilmiyor).
ALTER TABLE "cart_item_options" ADD COLUMN "netFiyat" BIGINT;
ALTER TABLE "cart_item_options" ADD COLUMN "komisyonTutari" BIGINT;
ALTER TABLE "cart_item_options" ADD COLUMN "malKdvTutari" BIGINT;
ALTER TABLE "cart_item_options" ADD COLUMN "hizmetKdvTutari" BIGINT;
