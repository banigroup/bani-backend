-- FAZ 0: puan alanlari User'dan Load-sahipli load_puanlari tablosuna tasinir (I-2 kapanisi)
-- SIRA KRITIK: once tablo + veri KOPYALAMA, en son kolon dusurme (veri kaybi yok)

CREATE TABLE "load_puanlari" (
    "userId" UUID NOT NULL,
    "ortalama" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sayi" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "load_puanlari_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "load_puanlari" ADD CONSTRAINT "load_puanlari_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mevcut puanlar kopyalanir (yalnizca puani olanlar)
INSERT INTO "load_puanlari" ("userId", "ortalama", "sayi")
SELECT "id", "puanOrtalama", "puanSayisi" FROM "users" WHERE "puanSayisi" > 0;

-- Cekirdek temizligi
ALTER TABLE "users" DROP COLUMN "puanOrtalama";
ALTER TABLE "users" DROP COLUMN "puanSayisi";