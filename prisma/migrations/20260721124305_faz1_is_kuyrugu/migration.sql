-- CreateEnum
CREATE TYPE "KuyrukDurum" AS ENUM ('BEKLIYOR', 'ISLENIYOR', 'TAMAM', 'HATA');

-- CreateTable
CREATE TABLE "is_kuyrugu" (
    "id" UUID NOT NULL,
    "tip" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "durum" "KuyrukDurum" NOT NULL DEFAULT 'BEKLIYOR',
    "denemeSayisi" INTEGER NOT NULL DEFAULT 0,
    "maxDeneme" INTEGER NOT NULL DEFAULT 3,
    "sonHata" TEXT,
    "calistirZamani" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "is_kuyrugu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "is_kuyrugu_durum_calistirZamani_idx" ON "is_kuyrugu"("durum", "calistirZamani");

-- CreateIndex
CREATE INDEX "is_kuyrugu_tip_idx" ON "is_kuyrugu"("tip");
