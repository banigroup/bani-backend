-- SEPET DIKEY AYRIMI
-- ============================================================================
-- Sepet artik kullanici basina DEGIL, kullanici+dikey basina tekil.
-- (carts.userId @unique  ->  @@unique([userId, businessUnit]))
--
-- ELLE YAZILDI. Prisma'nin uretecegi ham hali YETERSIZDI: kolonu
-- "NOT NULL DEFAULT 'MARKET'" ile eklemek, dolu 20 sepetin 16'sini
-- (YEMEK 8 + CARSI 5 + COFFEE 3) yanlis dikeye etiketlerdi; kullanici o
-- sepeti kendi vitrininde goremez, market vitrininde yabanci urunlerle
-- gorurdu. Bu yuzden 2. adimdaki BACKFILL bu dosyanin asil isidir.
--
-- Kayip riski yok: hicbir satir silinmiyor, cart_items'a dokunulmuyor.
-- Devir aninda her kullanicinin TAM 1 sepeti var (canli sayim), dolayisiyla
-- yeni bilesik unique hangi deger atanirsa atansin cakisamaz.
-- ============================================================================

-- 1) Kolon: gecici DEFAULT yalnizca mevcut satirlar dolsun diye.
ALTER TABLE "carts" ADD COLUMN "businessUnit" "BusinessUnit" NOT NULL DEFAULT 'MARKET';

-- 2) BACKFILL: sepetin dikeyi, kilitli oldugu magazanin dikeyidir.
--    storeId NULL olan sepetler BOSTUR (canli dogrulama: dolu-ama-magazasiz = 0),
--    onlarda MARKET kalmasi veri tasimadigi icin zararsizdir.
UPDATE "carts" c
SET "businessUnit" = s."businessUnit"
FROM "stores" s
WHERE s."id" = c."storeId";

-- 3) DEFAULT kaldirilir: bundan sonra dikey her INSERT'te ACIKCA verilmeli.
--    (Sema tarafinda da bilerek @default yok.)
ALTER TABLE "carts" ALTER COLUMN "businessUnit" DROP DEFAULT;

-- 4) Eski tekillik kalkar, yerine bilesik tekillik gelir.
--    userId onek oldugu icin "kullanicinin sepetleri" sorgusu indekssiz kalmaz.
DROP INDEX "carts_userId_key";
CREATE UNIQUE INDEX "carts_userId_businessUnit_key" ON "carts"("userId", "businessUnit");
