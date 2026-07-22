-- CreateEnum
CREATE TYPE "DonusYukuDurum" AS ENUM ('AKTIF', 'PASIF');

-- CreateTable
CREATE TABLE "donus_yuku_ilanlari" (
    "id" UUID NOT NULL,
    "tasiyanId" UUID NOT NULL,
    "durum" "DonusYukuDurum" NOT NULL DEFAULT 'AKTIF',
    "neredenIl" TEXT NOT NULL,
    "nereyeIl" TEXT NOT NULL,
    "tarihBas" TIMESTAMP(3) NOT NULL,
    "tarihBit" TIMESTAMP(3) NOT NULL,
    "aracTipi" TEXT,
    "aciklama" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "donus_yuku_ilanlari_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "donus_yuku_ilanlari_durum_tarihBas_idx" ON "donus_yuku_ilanlari"("durum", "tarihBas");

-- CreateIndex
CREATE INDEX "donus_yuku_ilanlari_neredenIl_nereyeIl_idx" ON "donus_yuku_ilanlari"("neredenIl", "nereyeIl");
