-- ELLE YAZILMIS MIGRATION (bir onceki 20260814120000_partner_basvuru_dicleful ile
-- ayni gerekce: migrate dev etkilesimsiz ortamda calismiyor; ifadeler Prisma'nin
-- "-- AlterTable" ciktisiyla birebir ayni).
--
-- AMAC: DicleFul teklif formunun (cargo sayfasi) topladigi ama PartnerBasvuru'da
--   karsiligi olmayan uc alan eklenir:
--     email     - iletisim e-postasi
--     aylikAdet - aylik siparis adedi (serbest metin: "500-1000" gibi girilebiliyor,
--                 bu yuzden INTEGER degil TEXT)
--     mesaj     - musterinin yazdigi talep metni
--   Bunlar olmadan form ya 400 aliyordu (ValidationPipe forbidNonWhitelisted:true)
--   ya da bu uc veri sessizce dusuyordu.
--
-- VERIYE ETKISI: YOK. Uc kolon da NULLABLE ve DEFAULT'suz eklenir; mevcut satirlara
--   NULL yazilir, hicbir UPDATE/DELETE yoktur. Diger 5 basvuru tipi (SELLER,
--   FRANCHISE, RESTAURANT, COURIER, MARKET) bu alanlari gondermez, NULL kalir.
--   Nullable kolon eklemek Postgres'te tablo yeniden yazmaz (metadata-only).
--
-- GERI ALMA: ALTER TABLE "partner_basvurulari" DROP COLUMN ... (enum'un aksine
--   kolon silme desteklenir; veri kaybi disinda kisit yok).

-- AlterTable
ALTER TABLE "partner_basvurulari" ADD COLUMN "email" TEXT;
ALTER TABLE "partner_basvurulari" ADD COLUMN "aylikAdet" TEXT;
ALTER TABLE "partner_basvurulari" ADD COLUMN "mesaj" TEXT;
