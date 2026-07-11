-- AlterTable
ALTER TABLE "users" ADD COLUMN     "puanOrtalama" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "puanSayisi" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "load_degerlendirmeler" (
    "id" UUID NOT NULL,
    "puan" INTEGER NOT NULL,
    "yorum" TEXT,
    "verenId" UUID NOT NULL,
    "alanId" UUID NOT NULL,
    "verenRol" TEXT NOT NULL,
    "yukIlaniId" UUID,
    "aracIlaniId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "load_degerlendirmeler_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "load_degerlendirmeler_alanId_idx" ON "load_degerlendirmeler"("alanId");

-- CreateIndex
CREATE UNIQUE INDEX "load_degerlendirmeler_verenId_yukIlaniId_key" ON "load_degerlendirmeler"("verenId", "yukIlaniId");

-- CreateIndex
CREATE UNIQUE INDEX "load_degerlendirmeler_verenId_aracIlaniId_key" ON "load_degerlendirmeler"("verenId", "aracIlaniId");

-- AddForeignKey
ALTER TABLE "load_degerlendirmeler" ADD CONSTRAINT "load_degerlendirmeler_verenId_fkey" FOREIGN KEY ("verenId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_degerlendirmeler" ADD CONSTRAINT "load_degerlendirmeler_alanId_fkey" FOREIGN KEY ("alanId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
