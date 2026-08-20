-- FAZ 3 / ADIM 1 — KATALOG VE MEDYA: alanlar, tablolar, medya backfill
-- ============================================================================
-- DAVRANIS DEGISMEZ. Bu adim yalnizca yer aciyor:
--   * Product'a katalog alanlari (barcode, productType, unitType, ...)
--   * Varyant / secenek / medya / muadil tablolari (HEPSI BOS acilir)
--   * CartItem.variantId ve OrderItem varyant snapshot'i (hepsi NULL)
-- Mevcut 319 urun varyantsiz kalir; variantId NULL yolu bugunku davranisin
-- birebir aynisini verir.
--
-- TARTILI URUN KURALI: quantity/stock EN KUCUK BIRIMDE TAM SAYI kalir
-- (750 g -> 750, price = gram basina kurus). unitType neyin sayildigini soyler.
-- Bu sayede orders.service'teki BigInt(quantity) carpimlarinin ve stok
-- decrement/increment mantiginin HICBIRI degismedi.
--
-- cart_items UNIQUE'i variantId'yi kapsayacak sekilde yenileniyor. Postgres'te
-- NULL != NULL oldugu icin varyantsiz satirlarda tekillik korumasi UYGULAMADA:
-- cart.service artik findFirst({ productId, variantId: null }) ile ariyor.
-- Kismi unique index tercih edilmedi - Prisma semasinda ifade edilemedigi icin
-- her migrate diff'te drift uretirdi.
-- ============================================================================

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('FIZIKSEL', 'YEMEK', 'HIZMET', 'MENU');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('ADET', 'GRAM', 'KILOGRAM', 'LITRE', 'MILILITRE', 'PORSIYON');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('NORMAL', 'EKSIK', 'IKAME');

-- DropIndex
DROP INDEX "cart_items_cartId_productId_key";

-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "variantId" UUID;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "status" "OrderItemStatus" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "unitType" "UnitType" NOT NULL DEFAULT 'ADET',
ADD COLUMN     "variantAdi" TEXT,
ADD COLUMN     "variantId" UUID;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "masterProductId" UUID,
ADD COLUMN     "minimumQuantity" INTEGER,
ADD COLUMN     "preparationTimeMinutes" INTEGER,
ADD COLUMN     "productType" "ProductType" NOT NULL DEFAULT 'FIZIKSEL',
ADD COLUMN     "quantityStep" INTEGER,
ADD COLUMN     "shortDescription" TEXT,
ADD COLUMN     "unitType" "UnitType" NOT NULL DEFAULT 'ADET';

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "price" BIGINT,
    "stock" INTEGER,
    "netFiyat" BIGINT,
    "komisyonTutari" BIGINT,
    "kargoTutari" BIGINT,
    "malKdvTutari" BIGINT,
    "hizmetKdvTutari" BIGINT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_groups" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "minSecim" INTEGER NOT NULL DEFAULT 0,
    "maxSecim" INTEGER NOT NULL DEFAULT 1,
    "zorunlu" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "options" (
    "id" UUID NOT NULL,
    "optionGroupId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ekUcret" BIGINT NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_groups" (
    "productId" UUID NOT NULL,
    "optionGroupId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_option_groups_pkey" PRIMARY KEY ("productId","optionGroupId")
);

-- CreateTable
CREATE TABLE "product_media" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "tur" TEXT NOT NULL DEFAULT 'GORSEL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_substitutions" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "substituteId" UUID NOT NULL,
    "oncelik" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_substitutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_item_options" (
    "id" UUID NOT NULL,
    "cartItemId" UUID NOT NULL,
    "optionId" UUID NOT NULL,
    "optionAdi" TEXT NOT NULL,
    "ekUcret" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_item_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_options" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "optionId" UUID,
    "optionAdi" TEXT NOT NULL,
    "ekUcret" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "order_item_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_variants_productId_isActive_idx" ON "product_variants"("productId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_productId_name_key" ON "product_variants"("productId", "name");

-- CreateIndex
CREATE INDEX "option_groups_storeId_idx" ON "option_groups"("storeId");

-- CreateIndex
CREATE INDEX "options_optionGroupId_idx" ON "options"("optionGroupId");

-- CreateIndex
CREATE INDEX "product_option_groups_optionGroupId_idx" ON "product_option_groups"("optionGroupId");

-- CreateIndex
CREATE INDEX "product_media_productId_sortOrder_idx" ON "product_media"("productId", "sortOrder");

-- CreateIndex
CREATE INDEX "product_substitutions_productId_oncelik_idx" ON "product_substitutions"("productId", "oncelik");

-- CreateIndex
CREATE UNIQUE INDEX "product_substitutions_productId_substituteId_key" ON "product_substitutions"("productId", "substituteId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_item_options_cartItemId_optionId_key" ON "cart_item_options"("cartItemId", "optionId");

-- CreateIndex
CREATE INDEX "order_item_options_orderItemId_idx" ON "order_item_options"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_productId_variantId_key" ON "cart_items"("cartId", "productId", "variantId");

-- CreateIndex
CREATE INDEX "products_barcode_idx" ON "products"("barcode");

-- CreateIndex
CREATE INDEX "products_masterProductId_idx" ON "products"("masterProductId");

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "options" ADD CONSTRAINT "options_optionGroupId_fkey" FOREIGN KEY ("optionGroupId") REFERENCES "option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_optionGroupId_fkey" FOREIGN KEY ("optionGroupId") REFERENCES "option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_substitutions" ADD CONSTRAINT "product_substitutions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_substitutions" ADD CONSTRAINT "product_substitutions_substituteId_fkey" FOREIGN KEY ("substituteId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item_options" ADD CONSTRAINT "cart_item_options_cartItemId_fkey" FOREIGN KEY ("cartItemId") REFERENCES "cart_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_options" ADD CONSTRAINT "order_item_options_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================================
-- BACKFILL: mevcut kapak gorselleri medya tablosuna kopyalanir.
-- Product.imageUrl KALDI - tum vitrin okumalari (cart.service view select dahil)
-- ona bakiyor; kaldirmak bu adimi gereksiz buyuturdu. Tek kaynaga indirme
-- sonraki adimda.
-- ============================================================================
INSERT INTO "product_media" ("id", "productId", "url", "tur", "sortOrder", "isPrimary", "createdAt")
SELECT gen_random_uuid(), p."id", p."imageUrl", 'GORSEL', 0, true, now()
FROM "products" p
WHERE p."imageUrl" IS NOT NULL AND btrim(p."imageUrl") <> '';
