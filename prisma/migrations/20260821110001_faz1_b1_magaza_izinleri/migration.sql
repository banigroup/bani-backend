-- FAZ 1 / B1 adim 2 — MAGAZA KADROSU ROLLERININ IZINLERI
--
-- Onceki migration (20260821110000) enum degerlerini ekledi; ADD VALUE ile
-- eklenen deger ayni transaction'da kullanilamadigi icin satirlar burada.
--
-- BEYAZ LISTE SINIRI: bu satirlarin tamami guard'daki KODDA SABIT beyaz
-- listenin (product:write, category:write, order:manage) icinde. Liste disina
-- cikan bir satir yazilsa bile guard onu kesisimde duserdi - yani bu tablo
-- magaza rollerine platform yetkisi VEREMEZ. Emsal: VITRIN_URUN_ALANLARI
-- (catalog.service.ts) - korunan sey, panelden yapilan hata.
--
-- STORE_STAFF BILEREK IZINSIZ: genel personel rolu, yalnizca "bu magazada
-- calisiyor" bilgisini tasir (erisebilir onu okur). Is bazli yetki uc yeni
-- rolde.
--
-- category:write hicbir role verilmedi: kategori agaci vitrin yapisidir,
-- magaza yoneticisinin isi. Beyaz listede duruyor ki ileride bir role
-- verilebilsin; bugun atil.

INSERT INTO "role_permissions" ("id", "role", "permissionKey") VALUES
  (gen_random_uuid(), 'STORE_KITCHEN', 'order:manage'),
  (gen_random_uuid(), 'STORE_CASHIER', 'order:manage'),
  (gen_random_uuid(), 'STORE_STOCK', 'product:write');

-- DOGRULAMA: uc satir eklendi, toplam 114 -> 117; hicbiri beyaz liste disinda
-- degil; STORE_STAFF hala izinsiz.
DO $$
DECLARE
  toplam       BIGINT;
  liste_disi   BIGINT;
  staff_izni   BIGINT;
BEGIN
  SELECT count(*) INTO toplam FROM "role_permissions";
  IF toplam <> 117 THEN
    RAISE EXCEPTION 'role_permissions beklenen 117, bulunan %', toplam;
  END IF;

  SELECT count(*) INTO liste_disi FROM "role_permissions"
    WHERE "role" IN ('STORE_STAFF', 'STORE_KITCHEN', 'STORE_CASHIER', 'STORE_STOCK')
      AND "permissionKey" NOT IN ('product:write', 'category:write', 'order:manage');
  IF liste_disi <> 0 THEN
    RAISE EXCEPTION 'magaza rolune beyaz liste disi izin verilmis: % satir', liste_disi;
  END IF;

  SELECT count(*) INTO staff_izni FROM "role_permissions" WHERE "role" = 'STORE_STAFF';
  IF staff_izni <> 0 THEN
    RAISE EXCEPTION 'STORE_STAFF izinsiz kalmaliydi, % satir bulundu', staff_izni;
  END IF;
END $$;
