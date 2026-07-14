-- CreateEnum
CREATE TYPE "SubeBasvuruDurum" AS ENUM ('YENI', 'ARANDI', 'TAMAMLANDI');

-- CreateTable
CREATE TABLE "SigortaSubeBasvuru" (
    "id" TEXT NOT NULL,
    "adSoyad" TEXT NOT NULL,
    "telefon" TEXT NOT NULL,
    "ilBolge" TEXT,
    "sektorTecrube" BOOLEAN NOT NULL DEFAULT false,
    "segemSertifika" BOOLEAN NOT NULL DEFAULT false,
    "aciklama" TEXT,
    "durum" "SubeBasvuruDurum" NOT NULL DEFAULT 'YENI',
    "adminNot" TEXT,
    "olusturmaTarihi" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SigortaSubeBasvuru_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SigortaSubeBasvuru_durum_idx" ON "SigortaSubeBasvuru"("durum");

-- CreateIndex
CREATE INDEX "SigortaSubeBasvuru_olusturmaTarihi_idx" ON "SigortaSubeBasvuru"("olusturmaTarihi");
