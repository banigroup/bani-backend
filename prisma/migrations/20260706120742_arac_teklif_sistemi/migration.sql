/*
  Warnings:

  - A unique constraint covering the columns `[seciliTeklifId]` on the table `arac_ilanlari` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "arac_ilanlari" ADD COLUMN     "aciklama" TEXT,
ADD COLUMN     "beklenenFiyatKurus" BIGINT,
ADD COLUMN     "seciliTeklifId" UUID;

-- CreateTable
CREATE TABLE "arac_teklifleri" (
    "id" UUID NOT NULL,
    "aracIlaniId" UUID NOT NULL,
    "verenId" UUID NOT NULL,
    "fiyatKurus" BIGINT NOT NULL,
    "mesaj" TEXT,
    "kabulTarihi" TIMESTAMP(3),
    "kabulIp" TEXT,
    "kabulCihaz" TEXT,
    "durum" "YukTeklifDurum" NOT NULL DEFAULT 'BEKLIYOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arac_teklifleri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "arac_teklifleri_aracIlaniId_idx" ON "arac_teklifleri"("aracIlaniId");

-- CreateIndex
CREATE INDEX "arac_teklifleri_verenId_idx" ON "arac_teklifleri"("verenId");

-- CreateIndex
CREATE UNIQUE INDEX "arac_ilanlari_seciliTeklifId_key" ON "arac_ilanlari"("seciliTeklifId");

-- AddForeignKey
ALTER TABLE "arac_ilanlari" ADD CONSTRAINT "arac_ilanlari_seciliTeklifId_fkey" FOREIGN KEY ("seciliTeklifId") REFERENCES "arac_teklifleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arac_teklifleri" ADD CONSTRAINT "arac_teklifleri_aracIlaniId_fkey" FOREIGN KEY ("aracIlaniId") REFERENCES "arac_ilanlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arac_teklifleri" ADD CONSTRAINT "arac_teklifleri_verenId_fkey" FOREIGN KEY ("verenId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
