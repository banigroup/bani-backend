-- KUYRUK DIKEY ALANI 3/3 — backfill
--
-- ILKE: businessUnit = isi ISLERKEN hangi dikeyin servis/DB yukune dokunuluyor
--       (TUKETEN taraf, URETEN taraf DEGIL).
--
-- SIGORTA_LEAD_OLUSTUR -> SIGORTA
--   Ureten: evdeneve.service.ts (LOAD dikeyi, ucret onayinda kuyruga birakir).
--   Tuketen: kuyruk.service switch'i SigortaService.leadOlustur'u cagirir ve
--   yazma sigorta_talepleri'ne gider. Yuk Sigorta'da, o yuzden SIGORTA.
--
-- BILDIRIM_SMS -> PLATFORM
--   Tuketen BildirimService + SMS saglayici; dikey-ustu altyapi.

UPDATE "is_kuyrugu" SET "businessUnit" = 'SIGORTA'
 WHERE "businessUnit" IS NULL AND "tip" = 'SIGORTA_LEAD_OLUSTUR';

UPDATE "is_kuyrugu" SET "businessUnit" = 'PLATFORM'
 WHERE "businessUnit" IS NULL AND "tip" = 'BILDIRIM_SMS';

-- DOGRULAMA: NULL kalan satir BIRAKILMAZ. Dikey filtreli bir worker NULL
-- satiri ASLA almaz (SQL'de NULL IN (...) false); boyle bir is sonsuza kadar
-- BEKLIYOR'da kalirdi. Bilinmeyen bir tip cikarsa migration burada durur ve
-- transaction geri alinir - kolon ve indeks olusmus kalir, veri bozulmaz.
DO $$
DECLARE
  bos       BIGINT;
  bilinmeyen TEXT;
BEGIN
  SELECT count(*) INTO bos FROM "is_kuyrugu" WHERE "businessUnit" IS NULL;
  IF bos <> 0 THEN
    SELECT string_agg(DISTINCT "tip", ', ') INTO bilinmeyen
      FROM "is_kuyrugu" WHERE "businessUnit" IS NULL;
    RAISE EXCEPTION 'businessUnit NULL kalan % satir (eslenmemis tip: %)', bos, bilinmeyen;
  END IF;
END $$;
