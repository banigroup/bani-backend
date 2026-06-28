/*
  Warnings:

  - A unique constraint covering the columns `[takipNo]` on the table `deliveries` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "DeliveryYontem" AS ENUM ('KENDI', 'ARACI');

-- CreateEnum
CREATE TYPE "KargoFirmasi" AS ENUM ('DICLEFUL', 'MNG', 'ARAS', 'YURTICI', 'PTT', 'SURAT', 'UPS');

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "kargoFirmasi" "KargoFirmasi",
ADD COLUMN     "takipNo" TEXT,
ADD COLUMN     "yontem" "DeliveryYontem" NOT NULL DEFAULT 'KENDI';

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_takipNo_key" ON "deliveries"("takipNo");
