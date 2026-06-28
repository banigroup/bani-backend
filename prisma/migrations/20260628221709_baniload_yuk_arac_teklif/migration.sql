-- CreateEnum
CREATE TYPE "YukIlaniDurum" AS ENUM ('ACIK', 'TEKLIF_ALINDI', 'ESLESTI', 'TASINIYOR', 'TAMAMLANDI', 'IPTAL');

-- CreateEnum
CREATE TYPE "AracTipi" AS ENUM ('TIR', 'KAMYON', 'KAMYONET', 'TENTELI', 'FRIGORIFIK', 'KAPALI_KASA', 'ACIK_KASA', 'LOWBED');

-- CreateEnum
CREATE TYPE "AracIlaniDurum" AS ENUM ('MUSAIT', 'DOLU', 'PASIF');

-- CreateEnum
CREATE TYPE "YukTeklifDurum" AS ENUM ('BEKLIYOR', 'KABUL', 'RED', 'GERI_CEKILDI');

-- CreateTable
CREATE TABLE "yuk_ilanlari" (
    "id" UUID NOT NULL,
    "verenId" UUID NOT NULL,
    "nereden" TEXT NOT NULL,
    "nereye" TEXT NOT NULL,
    "yukTipi" TEXT NOT NULL,
    "tonajKg" INTEGER NOT NULL,
    "aracTipiIhtiyaci" "AracTipi",
    "yuklemeTarihi" TIMESTAMP(3) NOT NULL,
    "aciklama" TEXT,
    "butceKurus" BIGINT,
    "durum" "YukIlaniDurum" NOT NULL DEFAULT 'ACIK',
    "seciliTeklifId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "yuk_ilanlari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arac_ilanlari" (
    "id" UUID NOT NULL,
    "tasiyiciId" UUID NOT NULL,
    "aracTipi" "AracTipi" NOT NULL,
    "nereden" TEXT NOT NULL,
    "nereye" TEXT NOT NULL,
    "cikisTarihi" TIMESTAMP(3) NOT NULL,
    "kapasiteKg" INTEGER NOT NULL,
    "durum" "AracIlaniDurum" NOT NULL DEFAULT 'MUSAIT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arac_ilanlari_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yuk_teklifleri" (
    "id" UUID NOT NULL,
    "yukIlaniId" UUID NOT NULL,
    "tasiyiciId" UUID NOT NULL,
    "fiyatKurus" BIGINT NOT NULL,
    "mesaj" TEXT,
    "durum" "YukTeklifDurum" NOT NULL DEFAULT 'BEKLIYOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "yuk_teklifleri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "yuk_ilanlari_seciliTeklifId_key" ON "yuk_ilanlari"("seciliTeklifId");

-- CreateIndex
CREATE INDEX "yuk_ilanlari_durum_idx" ON "yuk_ilanlari"("durum");

-- CreateIndex
CREATE INDEX "yuk_ilanlari_verenId_idx" ON "yuk_ilanlari"("verenId");

-- CreateIndex
CREATE INDEX "arac_ilanlari_durum_idx" ON "arac_ilanlari"("durum");

-- CreateIndex
CREATE INDEX "arac_ilanlari_tasiyiciId_idx" ON "arac_ilanlari"("tasiyiciId");

-- CreateIndex
CREATE INDEX "yuk_teklifleri_yukIlaniId_idx" ON "yuk_teklifleri"("yukIlaniId");

-- CreateIndex
CREATE INDEX "yuk_teklifleri_tasiyiciId_idx" ON "yuk_teklifleri"("tasiyiciId");

-- AddForeignKey
ALTER TABLE "yuk_ilanlari" ADD CONSTRAINT "yuk_ilanlari_verenId_fkey" FOREIGN KEY ("verenId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yuk_ilanlari" ADD CONSTRAINT "yuk_ilanlari_seciliTeklifId_fkey" FOREIGN KEY ("seciliTeklifId") REFERENCES "yuk_teklifleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arac_ilanlari" ADD CONSTRAINT "arac_ilanlari_tasiyiciId_fkey" FOREIGN KEY ("tasiyiciId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yuk_teklifleri" ADD CONSTRAINT "yuk_teklifleri_yukIlaniId_fkey" FOREIGN KEY ("yukIlaniId") REFERENCES "yuk_ilanlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yuk_teklifleri" ADD CONSTRAINT "yuk_teklifleri_tasiyiciId_fkey" FOREIGN KEY ("tasiyiciId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
