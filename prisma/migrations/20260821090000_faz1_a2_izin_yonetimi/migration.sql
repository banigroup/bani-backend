-- FAZ 1 / A2 adim 2 — IZIN YONETIMI UCLARI icin yeni izin: permission:manage
--
-- A2 adim 1'den sonra yeni bir izin eklemek ARTIK IKI YERI ilgilendiriyor:
-- Permission enum'i (derleme zamani guvenligi, 59 uc oradan besleniyor) ve
-- permissions tablosu (calisma zamani kaynagi). Ikisi ayrisirsa test yakalar
-- (test-izin-matrisi.js / 1. bolum, iki yonlu karsilastirma).
--
-- Yalnizca SUPER_ADMIN'e veriliyor: bu izne sahip olan kendi rolune de izin
-- yazabilir, yani yetki yukseltmenin anahtaridir.

INSERT INTO "permissions" ("key", "description") VALUES
  ('permission:manage', 'Rol-izin matrisini degistirme (SuperAdmin izin ekrani)');

INSERT INTO "role_permissions" ("id", "role", "permissionKey") VALUES
  (gen_random_uuid(), 'SUPER_ADMIN', 'permission:manage');

-- DOGRULAMA: adim 1'den gelen 28/113 uzerine tam olarak 1'er satir eklenmeli.
DO $$
DECLARE
  izin_sayisi BIGINT;
  cift_sayisi BIGINT;
  yonetim     BIGINT;
BEGIN
  SELECT count(*) INTO izin_sayisi FROM "permissions";
  SELECT count(*) INTO cift_sayisi FROM "role_permissions";
  IF izin_sayisi <> 29 THEN
    RAISE EXCEPTION 'permissions beklenen 29, bulunan %', izin_sayisi;
  END IF;
  IF cift_sayisi <> 114 THEN
    RAISE EXCEPTION 'role_permissions beklenen 114, bulunan %', cift_sayisi;
  END IF;
  -- KILITLENME KORUMASI: permission:manage yalnizca SUPER_ADMIN'de olmali ve
  -- ORADA OLMALI. Yoksa izin ekranini kimse acamaz.
  SELECT count(*) INTO yonetim FROM "role_permissions"
    WHERE "permissionKey" = 'permission:manage' AND "role" = 'SUPER_ADMIN';
  IF yonetim <> 1 THEN
    RAISE EXCEPTION 'permission:manage SUPER_ADMIN''e atanmadi';
  END IF;
END $$;
