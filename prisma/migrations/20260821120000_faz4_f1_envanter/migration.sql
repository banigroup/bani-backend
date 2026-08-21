-- FAZ 4 / F1 — ENVANTER TABLOLARI (ADDITIVE) + BACKFILL
--
-- DAVRANIS BU MIGRATION'DA DEGISMIYOR: okuma yolu (common/domain/varyant.etkinStok,
-- checkout stok kontrolu, sepet, vitrin filtresi) HALA Product.stock /
-- ProductVariant.stock kolonlarini okuyor. Bakiye tablosu bugun yalnizca
-- DOLDURULUYOR; kaynak olmasi F2'nin, eski kolonlarin dusurulmesi F4'un isi.
--
-- MIKTARLAR Int (kaynak belgedeki decimal'den BILINCLI SAPMA): sistemin kurali
-- "stok EN KUCUK BIRIMDE TAM SAYIDIR" ve siparis hattindaki BigInt(quantity)
-- carpimlarinin tamami buna dayaniyor.
--
-- store_id BAKIYEDE YOK, HAREKETTE VAR: bakiyede products.store_id'den
-- turetilebilir (ikinci kopya imkansiz durum yazilmasina izin verirdi);
-- harekette snapshot olarak duruyor.
--
-- reservedQuantity BU FAZDA HEP 0: gercek rezervasyon akisi (BR-004/005) Faz 5'e
-- (siparis durum makinesi) ertelendi - bugun sistemde "kabul/red" diye ayri bir
-- durum yok. Bilincli kapsam daraltmasi.

CREATE TYPE "MovementType" AS ENUM ('SATIS', 'IADE', 'GIRIS', 'TRANSFER', 'SAYIM', 'FIRE', 'DUZELTME');

CREATE TABLE "inventory_balances" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID,
    "availableQuantity" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "damagedQuantity" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("id")
);

-- NULLABLE UNIQUE: variantId NULL iken NULL != NULL (user_roles'taki ayni
-- bilincli borc). Yazma F2'de TEK KAPIDAN gececek; kismi unique indeks Prisma
-- semasinda ifade edilemedigi icin her migrate diff'te drift uretirdi.
CREATE UNIQUE INDEX "inventory_balances_productId_variantId_key" ON "inventory_balances"("productId", "variantId");
CREATE INDEX "inventory_balances_productId_idx" ON "inventory_balances"("productId");

ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID,
    "type" "MovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "beforeQty" INTEGER NOT NULL,
    "afterQty" INTEGER NOT NULL,
    "reason" TEXT,
    "referenceType" TEXT,
    "referenceId" UUID,
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_movements_productId_createdAt_idx" ON "inventory_movements"("productId", "createdAt");
CREATE INDEX "inventory_movements_storeId_createdAt_idx" ON "inventory_movements"("storeId", "createdAt");
CREATE INDEX "inventory_movements_referenceType_referenceId_idx" ON "inventory_movements"("referenceType", "referenceId");

-- RESTRICT: hareket DELILDIR. Turetilmis erisim kayitlarinda (store_users,
-- user_roles) Cascade tercih edilmisti; burasi wallets/deliveries.courierId sinifi.
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================ BACKFILL ============================
-- URUN DUZEYI: her urun icin bir satir, variantId NULL.
-- SILINMIS urunler de dahil: Product.deletedAt dolu olsa bile stok kolonu
-- duruyor ve F4'te dusurulecek; disarida birakilirsa o satirlarin stogu
-- kaybolurdu. Vitrin zaten deletedAt'e bakiyor, bakiye satirinin varligi
-- gorunurlugu degistirmez.
INSERT INTO "inventory_balances" ("id", "productId", "variantId", "availableQuantity", "updatedAt")
SELECT gen_random_uuid(), p."id", NULL, p."stock", now()
FROM "products" p;

-- VARYANT DUZEYI: yalnizca stock'u NOT NULL olan varyantlar.
-- stock NULL demek "urunun degeri gecerli" demek (bkz. etkinStok); o varyant
-- icin ayri satir yazilsaydi ayni stok IKI KEZ sayilirdi.
INSERT INTO "inventory_balances" ("id", "productId", "variantId", "availableQuantity", "updatedAt")
SELECT gen_random_uuid(), v."productId", v."id", v."stock", now()
FROM "product_variants" v
WHERE v."stock" IS NOT NULL;

-- ============================ DOGRULAMA ============================
-- Sayim tutmazsa migration ISTISNA atar ve transaction geri alinir: tablolar
-- olusmaz, canli veri oldugu gibi kalir (A1/A2'deki ayni koruma).
DO $$
DECLARE
  urun_sayisi     BIGINT;
  varyant_sayisi  BIGINT;
  bakiye_sayisi   BIGINT;
  urun_toplam     BIGINT;
  varyant_toplam  BIGINT;
  bakiye_toplam   BIGINT;
  eksik           BIGINT;
BEGIN
  SELECT count(*) INTO urun_sayisi FROM "products";
  SELECT count(*) INTO varyant_sayisi FROM "product_variants" WHERE "stock" IS NOT NULL;
  SELECT count(*) INTO bakiye_sayisi FROM "inventory_balances";

  IF bakiye_sayisi <> urun_sayisi + varyant_sayisi THEN
    RAISE EXCEPTION 'backfill satir sayisi tutmadi: beklenen % (urun %, varyant %), yazilan %',
      urun_sayisi + varyant_sayisi, urun_sayisi, varyant_sayisi, bakiye_sayisi;
  END IF;

  SELECT COALESCE(sum("stock"), 0) INTO urun_toplam FROM "products";
  SELECT COALESCE(sum("stock"), 0) INTO varyant_toplam FROM "product_variants" WHERE "stock" IS NOT NULL;
  SELECT COALESCE(sum("availableQuantity"), 0) INTO bakiye_toplam FROM "inventory_balances";

  IF bakiye_toplam <> urun_toplam + varyant_toplam THEN
    RAISE EXCEPTION 'backfill miktar toplami tutmadi: beklenen %, yazilan %',
      urun_toplam + varyant_toplam, bakiye_toplam;
  END IF;

  -- Bakiyesi olmayan urun kalmamali.
  SELECT count(*) INTO eksik FROM "products" p
    WHERE NOT EXISTS (SELECT 1 FROM "inventory_balances" b WHERE b."productId" = p."id" AND b."variantId" IS NULL);
  IF eksik <> 0 THEN
    RAISE EXCEPTION 'bakiyesi olmayan urun var: %', eksik;
  END IF;

  -- reserved/damaged bu fazda HEP 0 olmali.
  SELECT count(*) INTO eksik FROM "inventory_balances"
    WHERE "reservedQuantity" <> 0 OR "damagedQuantity" <> 0;
  IF eksik <> 0 THEN
    RAISE EXCEPTION 'reserved/damaged sifir olmaliydi: % satir', eksik;
  END IF;

  -- Hareket tablosu BOS baslar: gecmis hareket verisi yok (siparis gecmisinden
  -- geriye hareket uretmek, o siparislerin o anki stok durumunu bilmedigimiz
  -- icin uydurma before/after degerleri demek olurdu).
  SELECT count(*) INTO eksik FROM "inventory_movements";
  IF eksik <> 0 THEN
    RAISE EXCEPTION 'inventory_movements bos baslamaliydi: % satir', eksik;
  END IF;
END $$;
