-- CreateEnum
CREATE TYPE "EvIlaniDurum" AS ENUM ('ODEME_BEKLIYOR', 'ACIK', 'KESIF_SURECINDE', 'KILITLENDI', 'TAMAMLANDI', 'IPTAL');

-- CreateEnum
CREATE TYPE "EvTeklifDurum" AS ENUM ('ON_TEKLIF', 'KESFE_DAVET', 'KESIF_UYGUN', 'KESIF_REVIZE', 'KABUL', 'RED', 'GERI_CEKILDI');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SozlesmeTipi" ADD VALUE 'EVDEN_EVE_TASIYAN';
ALTER TYPE "SozlesmeTipi" ADD VALUE 'EVDEN_EVE_TASITAN';

-- CreateTable
CREATE TABLE "ev_ilanlari" (
    "id" UUID NOT NULL,
    "tasitanId" UUID NOT NULL,
    "durum" "EvIlaniDurum" NOT NULL DEFAULT 'ODEME_BEKLIYOR',
    "evTipi" TEXT NOT NULL,
    "neredenIl" TEXT NOT NULL,
    "neredenIlce" TEXT,
    "neredenKat" INTEGER,
    "neredenAsansor" BOOLEAN NOT NULL DEFAULT false,
    "nereyeIl" TEXT NOT NULL,
    "nereyeIlce" TEXT,
    "nereyeKat" INTEGER,
    "nereyeAsansor" BOOLEAN NOT NULL DEFAULT false,
    "alimTarihi" TIMESTAMP(3) NOT NULL,
    "teslimBaslangic" TIMESTAMP(3) NOT NULL,
    "teslimBitis" TIMESTAMP(3) NOT NULL,
    "fotograflar" JSONB NOT NULL,
    "aciklama" TEXT,
    "sigortaTalebi" BOOLEAN NOT NULL DEFAULT false,
    "ilanUcretiKurus" BIGINT,
    "ucretOnayZamani" TIMESTAMP(3),
    "seciliTeklifId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ev_ilanlari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ev_teklifleri" (
    "id" UUID NOT NULL,
    "evIlaniId" UUID NOT NULL,
    "tasiyanId" UUID NOT NULL,
    "durum" "EvTeklifDurum" NOT NULL DEFAULT 'ON_TEKLIF',
    "onTeklifKurus" BIGINT NOT NULL,
    "kesifRandevu" TIMESTAMP(3),
    "kesifZamani" TIMESTAMP(3),
    "kesinFiyatKurus" BIGINT,
    "kesifFotograflar" JSONB,
    "kesifNotu" TEXT,
    "kabulTarihi" TIMESTAMP(3),
    "kabulIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ev_teklifleri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ev_ilanlari_durum_alimTarihi_idx" ON "ev_ilanlari"("durum", "alimTarihi");

-- CreateIndex
CREATE INDEX "ev_ilanlari_tasitanId_idx" ON "ev_ilanlari"("tasitanId");

-- CreateIndex
CREATE INDEX "ev_ilanlari_neredenIl_nereyeIl_idx" ON "ev_ilanlari"("neredenIl", "nereyeIl");

-- CreateIndex
CREATE INDEX "ev_teklifleri_evIlaniId_durum_idx" ON "ev_teklifleri"("evIlaniId", "durum");

-- CreateIndex
CREATE INDEX "ev_teklifleri_tasiyanId_idx" ON "ev_teklifleri"("tasiyanId");
