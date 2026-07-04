-- CreateEnum
CREATE TYPE "LoadBelgeTipi" AS ENUM ('EHLIYET', 'SRC', 'K_BELGE', 'ARAC_RUHSAT', 'SIGORTA', 'VERGI_LEVHASI', 'IMZA_SIRKULERI', 'DIGER');

-- CreateEnum
CREATE TYPE "LoadBelgeDurum" AS ENUM ('BEKLIYOR', 'ONAYLANDI', 'REDDEDILDI');

-- CreateTable
CREATE TABLE "load_firma_profilleri" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "unvan" TEXT NOT NULL,
    "vergiDairesi" TEXT NOT NULL,
    "vkn" TEXT NOT NULL,
    "yetkiliAd" TEXT NOT NULL,
    "yetkiliSoyad" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "adres" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "load_firma_profilleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_tasiyici_profilleri" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "ad" TEXT NOT NULL,
    "soyad" TEXT NOT NULL,
    "tcKimlik" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "plaka" TEXT NOT NULL,
    "ehliyetNo" TEXT NOT NULL,
    "srcNo" TEXT NOT NULL,
    "kBelgeNo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "load_tasiyici_profilleri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_belgeleri" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tip" "LoadBelgeTipi" NOT NULL,
    "dosyaUrl" TEXT NOT NULL,
    "durum" "LoadBelgeDurum" NOT NULL DEFAULT 'BEKLIYOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "load_belgeleri_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "load_firma_profilleri_userId_key" ON "load_firma_profilleri"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "load_tasiyici_profilleri_userId_key" ON "load_tasiyici_profilleri"("userId");

-- CreateIndex
CREATE INDEX "load_belgeleri_userId_idx" ON "load_belgeleri"("userId");

-- AddForeignKey
ALTER TABLE "load_firma_profilleri" ADD CONSTRAINT "load_firma_profilleri_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_tasiyici_profilleri" ADD CONSTRAINT "load_tasiyici_profilleri_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_belgeleri" ADD CONSTRAINT "load_belgeleri_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
