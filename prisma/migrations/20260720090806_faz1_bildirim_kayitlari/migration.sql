-- CreateEnum
CREATE TYPE "BildirimKanal" AS ENUM ('SMS', 'EPOSTA');

-- CreateEnum
CREATE TYPE "BildirimDurum" AS ENUM ('GONDERILDI', 'HATA');

-- CreateTable
CREATE TABLE "bildirim_kayitlari" (
    "id" UUID NOT NULL,
    "kanal" "BildirimKanal" NOT NULL,
    "alici" TEXT NOT NULL,
    "sablonKodu" TEXT NOT NULL,
    "icerik" TEXT NOT NULL,
    "durum" "BildirimDurum" NOT NULL,
    "hataMesaji" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bildirim_kayitlari_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bildirim_kayitlari_alici_idx" ON "bildirim_kayitlari"("alici");

-- CreateIndex
CREATE INDEX "bildirim_kayitlari_sablonKodu_idx" ON "bildirim_kayitlari"("sablonKodu");

-- CreateIndex
CREATE INDEX "bildirim_kayitlari_createdAt_idx" ON "bildirim_kayitlari"("createdAt");
