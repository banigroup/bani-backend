-- CreateEnum
CREATE TYPE "PartnerBasvuruTip" AS ENUM ('SELLER', 'FRANCHISE', 'RESTAURANT', 'COURIER');

-- CreateEnum
CREATE TYPE "PartnerBasvuruDurum" AS ENUM ('BEKLIYOR', 'INCELENDI', 'ONAYLANDI', 'RED');

-- CreateTable
CREATE TABLE "partner_basvurulari" (
    "id" UUID NOT NULL,
    "tip" "PartnerBasvuruTip" NOT NULL,
    "durum" "PartnerBasvuruDurum" NOT NULL DEFAULT 'BEKLIYOR',
    "adSoyad" TEXT NOT NULL,
    "telefon" TEXT NOT NULL,
    "il" TEXT,
    "isletme" TEXT,
    "restoran" TEXT,
    "butce" TEXT,
    "aracTipi" TEXT,
    "businessUnit" "BusinessUnit",
    "not" TEXT,
    "ip" TEXT,
    "cihaz" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_basvurulari_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_basvurulari_tip_idx" ON "partner_basvurulari"("tip");

-- CreateIndex
CREATE INDEX "partner_basvurulari_durum_idx" ON "partner_basvurulari"("durum");
