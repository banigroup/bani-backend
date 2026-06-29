-- CreateEnum
CREATE TYPE "SozlesmeTipi" AS ENUM ('TASIYICI', 'YUK_VEREN');

-- AlterTable
ALTER TABLE "yuk_teklifleri" ADD COLUMN     "kabulCihaz" TEXT,
ADD COLUMN     "kabulIp" TEXT,
ADD COLUMN     "kabulTarihi" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sozlesme_onaylari" (
    "id" UUID NOT NULL,
    "kullaniciId" UUID NOT NULL,
    "sozlesmeTipi" "SozlesmeTipi" NOT NULL,
    "surum" TEXT NOT NULL,
    "metinHash" TEXT NOT NULL,
    "ip" TEXT,
    "cihaz" TEXT,
    "onayTarihi" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sozlesme_onaylari_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sozlesme_onaylari_kullaniciId_idx" ON "sozlesme_onaylari"("kullaniciId");

-- CreateIndex
CREATE UNIQUE INDEX "sozlesme_onaylari_kullaniciId_sozlesmeTipi_surum_key" ON "sozlesme_onaylari"("kullaniciId", "sozlesmeTipi", "surum");

-- AddForeignKey
ALTER TABLE "sozlesme_onaylari" ADD CONSTRAINT "sozlesme_onaylari_kullaniciId_fkey" FOREIGN KEY ("kullaniciId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
