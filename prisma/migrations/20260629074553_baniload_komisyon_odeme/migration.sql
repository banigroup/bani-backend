-- CreateEnum
CREATE TYPE "KomisyonOdemeYontem" AS ENUM ('HAVALE', 'KART');

-- CreateEnum
CREATE TYPE "KomisyonOdemeDurum" AS ENUM ('BEKLIYOR', 'ONAYLANDI', 'RED');

-- CreateTable
CREATE TABLE "komisyon_odemeleri" (
    "id" UUID NOT NULL,
    "tasiyiciId" UUID NOT NULL,
    "tutarKurus" BIGINT NOT NULL,
    "yontem" "KomisyonOdemeYontem" NOT NULL DEFAULT 'HAVALE',
    "durum" "KomisyonOdemeDurum" NOT NULL DEFAULT 'BEKLIYOR',
    "dekont" TEXT,
    "adminNot" TEXT,
    "onaylayanId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "komisyon_odemeleri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "komisyon_odemeleri_tasiyiciId_idx" ON "komisyon_odemeleri"("tasiyiciId");

-- CreateIndex
CREATE INDEX "komisyon_odemeleri_durum_idx" ON "komisyon_odemeleri"("durum");

-- AddForeignKey
ALTER TABLE "komisyon_odemeleri" ADD CONSTRAINT "komisyon_odemeleri_tasiyiciId_fkey" FOREIGN KEY ("tasiyiciId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
