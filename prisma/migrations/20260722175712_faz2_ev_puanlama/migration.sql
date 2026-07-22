/*
  Warnings:

  - A unique constraint covering the columns `[verenId,evIlaniId]` on the table `load_degerlendirmeler` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "load_degerlendirmeler" ADD COLUMN     "evIlaniId" UUID;

-- AlterTable
ALTER TABLE "load_puanlari" ADD COLUMN     "evOrtalama" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "evSayi" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "load_degerlendirmeler_verenId_evIlaniId_key" ON "load_degerlendirmeler"("verenId", "evIlaniId");
