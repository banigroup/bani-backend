-- ELLE YAZILMIS MIGRATION (prisma migrate dev, @unique eklenmesi icin etkilesimli
-- onay istedigi ve ortam etkilesimsiz oldugu icin durdu; SQL `prisma migrate diff`
-- ile uretildi, icerik Prisma'nin uretecegiyle birebir ayni).
--
-- SORUN: Evden Eve modulunde EvIlani <-> EvTeklif bagi FK'siz duz UUID kolonuydu.
--   Yerelde kanitlandi: var olmayan bir ilana teklif yazilabiliyor ve bir ilanin
--   seciliTeklifId'si var olmayan teklife baglanabiliyordu - ikisi de hatasiz.
--
-- COZUM: Ayni dikey icindeki bu iki baga FK. Holding ilkesi ihlal edilmiyor:
--   dikeyler arasi baglar (tasitanId / tasiyanId -> User) duz ID olarak KALIYOR.
--
--   ev_teklifleri.evIlaniId -> ev_ilanlari.id      ON DELETE RESTRICT
--     Teklif is delilidir (kabulTarihi/kabulIp, kesif fotograflari). Teklif almis
--     ilan silinemez - yuk/arac tarafiyla ayni kural (bkz. 20260811085033).
--
--   ev_ilanlari.seciliTeklifId -> ev_teklifleri.id  ON DELETE SET NULL
--     Opsiyonel 1-1 bag; Prisma'nin opsiyonel iliski varsayilani. Teklif silinirse
--     ilan oksuz ID tasimaz, bag temizlenir.
--
-- VERIYE ETKISI: YOK. Sadece index + kisit ekler; ALTER COLUMN / UPDATE / DELETE yok.
--   Migration oncesi hem yerelde hem CANLIDA dogrulandi:
--     oksuz teklif = 0, oksuz seciliTeklifId = 0, mukerrer seciliTeklifId = 0
--   (canli: 3 ev ilani, 1 teklif, 1 secili bag - hepsi tutarli).
--   Geri alma:
--     ALTER TABLE "ev_teklifleri" DROP CONSTRAINT "ev_teklifleri_evIlaniId_fkey";
--     ALTER TABLE "ev_ilanlari"  DROP CONSTRAINT "ev_ilanlari_seciliTeklifId_fkey";
--     DROP INDEX "ev_ilanlari_seciliTeklifId_key";

-- CreateIndex
CREATE UNIQUE INDEX "ev_ilanlari_seciliTeklifId_key" ON "ev_ilanlari"("seciliTeklifId");

-- AddForeignKey
ALTER TABLE "ev_ilanlari" ADD CONSTRAINT "ev_ilanlari_seciliTeklifId_fkey" FOREIGN KEY ("seciliTeklifId") REFERENCES "ev_teklifleri"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ev_teklifleri" ADD CONSTRAINT "ev_teklifleri_evIlaniId_fkey" FOREIGN KEY ("evIlaniId") REFERENCES "ev_ilanlari"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
