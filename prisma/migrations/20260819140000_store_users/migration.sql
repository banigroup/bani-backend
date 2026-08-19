-- MAGAZA PERSONELI (store_users)
-- ============================================================================
-- Magazaya erisim bugune kadar tek kaynaktan geliyordu: stores.ownerId.
-- MARKET_OPERATOR / RESTAURANT / COFFEE_BRANCH rolleri ORDER_MANAGE iznini
-- tasiyip sahibi olmadiklari magazada 403 aliyordu - izni olan, verisi olmayan
-- roller. Bu tablo o bosluğu kapatir.
--
-- SAHIPLIK TASINMADI: stores.ownerId yerinde kalir (satici hakedisi onun
-- cuzdanina yaziliyor). Uyelik yalnizca OPERASYONEL erisim verir.
--
-- BACKFILL YOK ve bu bilinclidir: sahipler zaten ownerId uzerinden geciyor,
-- onlari ayrica uye olarak yazmak iki dogruluk kaynagi yaratirdi. Tablo BOS
-- acilir; canlida (5 magaza, tek sahip, uye adayi 0 kullanici) hicbir davranis
-- degismez.
-- ============================================================================

CREATE TABLE "store_users" (
    "id"        UUID NOT NULL,
    "storeId"   UUID NOT NULL,
    "userId"    UUID NOT NULL,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_users_pkey" PRIMARY KEY ("id")
);

-- Bir kisi bir magazada TEK uyelik tasir.
CREATE UNIQUE INDEX "store_users_storeId_userId_key" ON "store_users"("storeId", "userId");

-- "Bu kullanicinin magazalari" sorgusu icin AYRICA gerekli: yukaridaki bilesik
-- unique'in oneki storeId oldugu icin userId ile arama ondan yararlanamaz.
CREATE INDEX "store_users_userId_idx" ON "store_users"("userId");

-- Cascade (iki tarafta da): uyelik turetilmis erisim kaydidir, deger/delil
-- tasimaz. Magaza ya da kullanici yoksa kaydin anlami kalmaz.
ALTER TABLE "store_users" ADD CONSTRAINT "store_users_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_users" ADD CONSTRAINT "store_users_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
