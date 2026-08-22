-- KUYRUK DIKEY ALANI 1/3 — BusinessUnit'e SIGORTA
--
-- Sigorta sistemde zaten bir dikey (sigorta_talepleri, sigorta_sube_basvurulari,
-- SigortaModule) ama BusinessUnit onu tanimiyordu. is_kuyrugu.businessUnit ile
-- birlikte ekleniyor.
--
-- MIGRATION UCE BOLUNDU: Postgres'te ALTER TYPE ... ADD VALUE ile eklenen deger
-- AYNI TRANSACTION icinde KULLANILAMAZ. Backfill (3/3) bu degeri kullandigi
-- icin ayri dosyada. Ayni bolme B1'de de yapilmisti.

ALTER TYPE "BusinessUnit" ADD VALUE 'SIGORTA';
