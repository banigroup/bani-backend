-- CreateEnum
CREATE TYPE "SigortaTuru" AS ENUM ('TRAFIK', 'KASKO', 'DASK', 'KONUT', 'SAGLIK', 'NAKLIYAT', 'FERDI_KAZA', 'ISYERI', 'HAYAT', 'DIGER');

-- CreateEnum
CREATE TYPE "SigortaKaynak" AS ENUM ('STANDALONE', 'BANILOAD');

-- CreateEnum
CREATE TYPE "SigortaDurum" AS ENUM ('YENI', 'ARANDI', 'TAMAMLANDI');

-- CreateTable
CREATE TABLE "SigortaTalep" (
    "id" TEXT NOT NULL,
    "adSoyad" TEXT NOT NULL,
    "telefon" TEXT NOT NULL,
    "sigortaTuru" "SigortaTuru" NOT NULL,
    "kaynak" "SigortaKaynak" NOT NULL DEFAULT 'STANDALONE',
    "durum" "SigortaDurum" NOT NULL DEFAULT 'YENI',
    "adminNot" TEXT,
    "olusturmaTarihi" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SigortaTalep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SigortaTalep_durum_idx" ON "SigortaTalep"("durum");

-- CreateIndex
CREATE INDEX "SigortaTalep_olusturmaTarihi_idx" ON "SigortaTalep"("olusturmaTarihi");
