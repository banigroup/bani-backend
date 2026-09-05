-- CreateTable
CREATE TABLE "platform_hizmet_bolgeleri" (
    "id" UUID NOT NULL,
    "il" TEXT NOT NULL,
    "ilce" TEXT NOT NULL,
    "mahalle" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_hizmet_bolgeleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magaza_teslimat_bolgeleri" (
    "id" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "il" TEXT NOT NULL,
    "ilce" TEXT NOT NULL,
    "mahalle" TEXT,
    "feeKurus" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magaza_teslimat_bolgeleri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_hizmet_bolgeleri_il_ilce_idx" ON "platform_hizmet_bolgeleri"("il", "ilce");

-- CreateIndex
CREATE UNIQUE INDEX "platform_hizmet_bolgeleri_il_ilce_mahalle_key" ON "platform_hizmet_bolgeleri"("il", "ilce", "mahalle");

-- CreateIndex
CREATE INDEX "magaza_teslimat_bolgeleri_storeId_idx" ON "magaza_teslimat_bolgeleri"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "magaza_teslimat_bolgeleri_storeId_il_ilce_mahalle_key" ON "magaza_teslimat_bolgeleri"("storeId", "il", "ilce", "mahalle");

-- AddForeignKey
ALTER TABLE "magaza_teslimat_bolgeleri" ADD CONSTRAINT "magaza_teslimat_bolgeleri_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- BASLANGIC KAPSAMI (seed)
--
-- Degerler CANLI OLCUMDEN geldi: 2026-09-05'te canli adres tablosunda gecen
-- il/ilce ciftleri Diyarbakir/Kayapinar (3 adres) ve Adana/Ceyhan (1 adres)
-- idi. Kanonik yazim (buyuk harfli, Turkce karakterli) esas alindi; canlida
-- ayni ilce yalnizca bas harfte ayrisan ikinci bir yazimla da kayitliydi ve
-- karsilastirma bu yuzden normalize ediliyor (market.service bolgeAnahtar).
--
-- mahalle NULL: iki ilce de BUTUNUYLE acik. Mahalle kirilimi gerektiginde
-- SuperAdmin bu ilceye mahalle satirlari ekler; o an NULL satir kaldirilmali
-- (NULL satir varken mahalle satirlari etkisizdir).
--
-- IDEMPOTENT: ON CONFLICT KULLANILMADI. mahalle NULL oldugu icin unique index
-- calismaz (Postgres'te NULL != NULL), bu yuzden varlik kontrolu WHERE NOT
-- EXISTS ile yapiliyor - migration iki kez calissa bile satir cogalmaz.
-- ============================================================================
INSERT INTO "platform_hizmet_bolgeleri" ("id", "il", "ilce", "mahalle", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Diyarbakır', 'Kayapınar', NULL, true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "platform_hizmet_bolgeleri"
  WHERE "il" = 'Diyarbakır' AND "ilce" = 'Kayapınar' AND "mahalle" IS NULL
);

INSERT INTO "platform_hizmet_bolgeleri" ("id", "il", "ilce", "mahalle", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Adana', 'Ceyhan', NULL, true, NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "platform_hizmet_bolgeleri"
  WHERE "il" = 'Adana' AND "ilce" = 'Ceyhan' AND "mahalle" IS NULL
);
