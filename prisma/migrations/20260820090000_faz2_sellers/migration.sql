-- FAZ 2 — SATICI (sellers), BOLGE (regions), CALISMA SAATLERI (store_hours)
-- ============================================================================
-- Magazanin arkasindaki TICARI KIMLIK bugune kadar hic modellenmemisti: satici
-- = User + rol + stores.ownerId idi. Bu migration Seller katmanini ekler.
--
-- SAHIPLIK TASINMADI: stores.ownerId yerinde kalir. Satici hakedisi
-- delivery.service icinde order.store.ownerId cuzdanina yaziliyor; sahipligi
-- tasimak canlida para dagitan tek transaction'a dokunmak olurdu. sellerId EK
-- bir bagdir (kod tabaninda ownerId 12 yerde gecer, yalnizca 1'i para yolu).
--
-- SIRA ONEMLI: Prisma'nin urettigi ham DDL "sellerId UUID NOT NULL" ekliyordu;
-- mevcut 5 magaza satirinda bu HATA verirdi. Burada kolon NULLABLE eklenir,
-- backfill yapilir, sonra NOT NULL'a cekilir.
-- ============================================================================

-- 1) ENUM'LAR
CREATE TYPE "SellerType" AS ENUM ('RESTORAN', 'MARKET', 'URETICI', 'LOJISTIK', 'HIZMET');
CREATE TYPE "SellerStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'ACTIVE', 'NEEDS_FIX', 'SUSPENDED', 'CLOSED');
CREATE TYPE "SellerVerification" AS ENUM ('EKSIK', 'BEKLIYOR', 'ONAYLANDI', 'REDDEDILDI', 'SURESI_DOLDU');

-- 2) TABLOLAR
CREATE TABLE "sellers" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "sellerType" "SellerType" NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    -- AES-256-GCM ile sifreli blob ("v1:iv:tag:ciphertext"). Anahtar yalnizca
    -- ortam degiskeninde; pgcrypto secilmedi ki anahtar SQL metnine gomulup
    -- sorgu logu / query cache uzerinden sizmasin.
    "taxIdentifier" TEXT,
    "taxLast4" TEXT,
    "status" "SellerStatus" NOT NULL DEFAULT 'DRAFT',
    "verification" "SellerVerification" NOT NULL DEFAULT 'EKSIK',
    -- "Suresi Doldu" bir DURUM degil SONUC: tarih burada tutulur, enum degeri
    -- arka plan isi tarafindan guncellenir.
    "verificationExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "regions" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_hours" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "openTime" TIME(0) NOT NULL,
    "closeTime" TIME(0) NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" DATE NOT NULL,
    "effectiveUntil" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_hours_pkey" PRIMARY KEY ("id")
);

-- 3) STORES: yeni kolonlar (sellerId SIMDILIK NULLABLE)
ALTER TABLE "stores" ADD COLUMN "sellerId" UUID;
ALTER TABLE "stores" ADD COLUMN "parentId" UUID;
ALTER TABLE "stores" ADD COLUMN "regionId" UUID;

-- 4) BACKFILL: her farkli magaza sahibi icin BIR satici
--    Canli olcum: silinmemis 5 magazanin tamami tek ownerId'de -> 1 satir.
--
--    status = 'ACTIVE': bu magazalar canlida satis yapiyor. 'DRAFT' yazmak
--    BR-001 devreye girdiginde onlari kilitlerdi.
--    verification = 'EKSIK': hicbiri dogrulanmadi; 'ONAYLANDI' yazmak veriyi
--    yalanlamak olurdu.
--    sellerType = 'MARKET': YER TUTUCU. Gercek tur (restoran/uretici/...) satici
--    ya da admin tarafindan duzeltilmelidir; tek satir oldugu icin elle duzeltme
--    maliyeti sifira yakin.
INSERT INTO "sellers" (
  "id", "ownerUserId", "sellerType", "legalName", "displayName",
  "status", "verification", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  u."id",
  'MARKET',
  coalesce(nullif(btrim(concat_ws(' ', u."name", u."surname")), ''), 'Satici ' || left(u."id"::text, 8)),
  coalesce(nullif(btrim(concat_ws(' ', u."name", u."surname")), ''), 'Satici ' || left(u."id"::text, 8)),
  'ACTIVE',
  'EKSIK',
  now(), now()
FROM (SELECT DISTINCT "ownerId" AS id FROM "stores" WHERE "deletedAt" IS NULL) o
JOIN "users" u ON u."id" = o.id;

UPDATE "stores" st
SET "sellerId" = se."id"
FROM "sellers" se
WHERE se."ownerUserId" = st."ownerId";

-- 5) Backfill tamam -> kolon zorunlu olur.
--    Silinmis (deletedAt dolu) magaza kalmissa bu adim HATA verir ve migration
--    durur; sessizce yanlis veri birakmaktansa gurultulu hata tercih edilir.
ALTER TABLE "stores" ALTER COLUMN "sellerId" SET NOT NULL;

-- 6) INDEKSLER
CREATE INDEX "sellers_ownerUserId_idx" ON "sellers"("ownerUserId");
CREATE INDEX "sellers_status_idx" ON "sellers"("status");
CREATE UNIQUE INDEX "regions_code_key" ON "regions"("code");
CREATE INDEX "regions_parentId_idx" ON "regions"("parentId");
CREATE INDEX "store_hours_storeId_idx" ON "store_hours"("storeId");
CREATE UNIQUE INDEX "store_hours_storeId_weekday_effectiveFrom_key" ON "store_hours"("storeId", "weekday", "effectiveFrom");
CREATE INDEX "stores_sellerId_idx" ON "stores"("sellerId");
CREATE INDEX "stores_parentId_idx" ON "stores"("parentId");

-- 7) FK'LAR
--    sellers -> users        : RESTRICT (satici kaydi olan kullanici silinemez)
--    stores  -> sellers      : RESTRICT (saticisi silinince magazalar sessizce kaybolmasin)
--    stores  -> stores       : RESTRICT (subesi olan merkez silinemez)
--    stores  -> regions      : SET NULL (bolge silinse de magaza yasar)
--    store_hours -> stores   : CASCADE  (magaza yoksa saatin anlami yok)
ALTER TABLE "sellers" ADD CONSTRAINT "sellers_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "regions" ADD CONSTRAINT "regions_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "store_hours" ADD CONSTRAINT "store_hours_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stores" ADD CONSTRAINT "stores_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stores" ADD CONSTRAINT "stores_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stores" ADD CONSTRAINT "stores_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
