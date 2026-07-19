-- FAZ 0: Soft Delete + birim defteri + index + sigorta rename
-- ELLE DUZELTILDI: DROP+CREATE yerine RENAME (veri korunur); businessUnit NOT NULL oncesi backfill

-- AlterTable (Soft Delete kolonlari)
ALTER TABLE "arac_ilanlari" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "arac_teklifleri" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "deliveries" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "komisyon_odemeleri" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "load_belgeleri" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "partner_basvurulari" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "yuk_ilanlari" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "yuk_teklifleri" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Transactions: deletedAt + businessUnit backfill + NOT NULL
ALTER TABLE "transactions" ADD COLUMN "deletedAt" TIMESTAMP(3);
UPDATE "transactions" SET "businessUnit" = 'LOAD' WHERE "businessUnit" IS NULL;
ALTER TABLE "transactions" ALTER COLUMN "businessUnit" SET NOT NULL;

-- Wallets: birim defteri kolonu (Faz 1'de zorunlulasir)
ALTER TABLE "wallets" ADD COLUMN "businessUnit" "BusinessUnit";

-- SigortaTalep: RENAME (DROP DEGIL - canli lead korunur)
ALTER TABLE "SigortaTalep" RENAME TO "sigorta_talepleri";
ALTER TABLE "sigorta_talepleri" RENAME CONSTRAINT "SigortaTalep_pkey" TO "sigorta_talepleri_pkey";
ALTER INDEX "SigortaTalep_durum_idx" RENAME TO "sigorta_talepleri_durum_idx";
ALTER INDEX "SigortaTalep_olusturmaTarihi_idx" RENAME TO "sigorta_talepleri_olusturmaTarihi_idx";
ALTER TABLE "sigorta_talepleri" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- SigortaSubeBasvuru: RENAME (DROP DEGIL)
ALTER TABLE "SigortaSubeBasvuru" RENAME TO "sigorta_sube_basvurulari";
ALTER TABLE "sigorta_sube_basvurulari" RENAME CONSTRAINT "SigortaSubeBasvuru_pkey" TO "sigorta_sube_basvurulari_pkey";
ALTER INDEX "SigortaSubeBasvuru_durum_idx" RENAME TO "sigorta_sube_basvurulari_durum_idx";
ALTER INDEX "SigortaSubeBasvuru_olusturmaTarihi_idx" RENAME TO "sigorta_sube_basvurulari_olusturmaTarihi_idx";
ALTER TABLE "sigorta_sube_basvurulari" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Yeni indexler (cron + liste sorgulari)
CREATE INDEX "arac_ilanlari_durum_cikisTarihi_idx" ON "arac_ilanlari"("durum", "cikisTarihi");
CREATE INDEX "yuk_ilanlari_durum_yuklemeTarihi_idx" ON "yuk_ilanlari"("durum", "yuklemeTarihi");