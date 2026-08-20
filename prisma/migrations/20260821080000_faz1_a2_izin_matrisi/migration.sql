-- FAZ 1 / A2 — IZIN MATRISI TABLOYA TASINDI (role-permissions.ts -> role_permissions)
--
-- Neden: izin degisikligini yapacak kisi operasyon/IK olacak. Bugun matris kodda
-- oldugu icin tek bir izin eklemek PR + deploy bekliyor. A2'den sonra kaynak TABLO;
-- SuperAdmin panelinden degistirilecek (yonetim uclari A2/adim 2'de gelir).
--
-- DAVRANIS BU MIGRATION'DA DEGISMIYOR: asagidaki satirlar bugunku ROLE_PERMISSIONS
-- haritasindan UretilDI (kod okunarak, elle yazilmadi). 28 izin, 12 rol, 113 cift.
--
-- Permission ENUM OLARAK KALIYOR (Role gibi): 59 uctaki @RequirePermissions(...)
-- derleme zamani guvenligini oradan aliyor. Tablo enum degerlerini SATIR olarak
-- tutar; iki taraf arasindaki tutarlilik testle dogrulanir.

CREATE TABLE "permissions" (
    "key" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_permissions_role_permissionKey_key" ON "role_permissions"("role", "permissionKey");
-- Her istekte okunan yol: PermissionsGuard -> IzinMatrisi.yukle (rol bazli).
CREATE INDEX "role_permissions_role_idx" ON "role_permissions"("role");

-- Izin silinince o izne dayanan atamalar da anlamsizdir (turetilmis kayit).
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionKey_fkey"
    FOREIGN KEY ("permissionKey") REFERENCES "permissions"("key") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "permissions" ("key") VALUES
  ('user:read'),
  ('user:write'),
  ('user:role:assign'),
  ('user:suspend'),
  ('address:read'),
  ('address:write'),
  ('wallet:read'),
  ('wallet:topup'),
  ('payment:initiate'),
  ('wallet:withdraw'),
  ('transaction:read'),
  ('transaction:reverse'),
  ('audit:read'),
  ('store:read'),
  ('store:write'),
  ('store:manage:all'),
  ('product:read'),
  ('product:write'),
  ('category:write'),
  ('product:approve'),
  ('order:read'),
  ('order:write'),
  ('order:manage'),
  ('delivery:read'),
  ('delivery:claim'),
  ('delivery:manage'),
  ('finance:read'),
  ('finance:report:read');

INSERT INTO "role_permissions" ("id", "role", "permissionKey") VALUES
  (gen_random_uuid(), 'SUPER_ADMIN', 'user:read'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'user:write'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'user:role:assign'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'user:suspend'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'address:read'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'address:write'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'wallet:read'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'wallet:topup'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'payment:initiate'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'wallet:withdraw'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'transaction:read'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'transaction:reverse'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'audit:read'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'store:read'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'store:write'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'store:manage:all'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'product:read'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'product:write'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'category:write'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'product:approve'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'order:read'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'order:write'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'order:manage'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'delivery:read'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'delivery:claim'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'delivery:manage'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'finance:read'),
  (gen_random_uuid(), 'SUPER_ADMIN', 'finance:report:read'),
  (gen_random_uuid(), 'ADMIN', 'user:read'),
  (gen_random_uuid(), 'ADMIN', 'address:read'),
  (gen_random_uuid(), 'ADMIN', 'store:read'),
  (gen_random_uuid(), 'ADMIN', 'store:write'),
  (gen_random_uuid(), 'ADMIN', 'store:manage:all'),
  (gen_random_uuid(), 'ADMIN', 'product:read'),
  (gen_random_uuid(), 'ADMIN', 'product:write'),
  (gen_random_uuid(), 'ADMIN', 'category:write'),
  (gen_random_uuid(), 'ADMIN', 'product:approve'),
  (gen_random_uuid(), 'ADMIN', 'order:read'),
  (gen_random_uuid(), 'ADMIN', 'order:manage'),
  (gen_random_uuid(), 'ADMIN', 'delivery:read'),
  (gen_random_uuid(), 'ADMIN', 'delivery:manage'),
  (gen_random_uuid(), 'ADMIN', 'audit:read'),
  (gen_random_uuid(), 'ADMIN', 'finance:report:read'),
  (gen_random_uuid(), 'CUSTOMER', 'address:read'),
  (gen_random_uuid(), 'CUSTOMER', 'address:write'),
  (gen_random_uuid(), 'CUSTOMER', 'wallet:read'),
  (gen_random_uuid(), 'CUSTOMER', 'payment:initiate'),
  (gen_random_uuid(), 'CUSTOMER', 'store:read'),
  (gen_random_uuid(), 'CUSTOMER', 'product:read'),
  (gen_random_uuid(), 'CUSTOMER', 'order:read'),
  (gen_random_uuid(), 'CUSTOMER', 'order:write'),
  (gen_random_uuid(), 'COURIER', 'address:read'),
  (gen_random_uuid(), 'COURIER', 'wallet:read'),
  (gen_random_uuid(), 'COURIER', 'transaction:read'),
  (gen_random_uuid(), 'COURIER', 'delivery:read'),
  (gen_random_uuid(), 'COURIER', 'delivery:claim'),
  (gen_random_uuid(), 'COURIER', 'delivery:manage'),
  (gen_random_uuid(), 'MERCHANT', 'address:read'),
  (gen_random_uuid(), 'MERCHANT', 'address:write'),
  (gen_random_uuid(), 'MERCHANT', 'wallet:read'),
  (gen_random_uuid(), 'MERCHANT', 'transaction:read'),
  (gen_random_uuid(), 'MERCHANT', 'store:read'),
  (gen_random_uuid(), 'MERCHANT', 'store:write'),
  (gen_random_uuid(), 'MERCHANT', 'product:read'),
  (gen_random_uuid(), 'MERCHANT', 'product:write'),
  (gen_random_uuid(), 'MERCHANT', 'category:write'),
  (gen_random_uuid(), 'MERCHANT', 'order:read'),
  (gen_random_uuid(), 'MERCHANT', 'order:manage'),
  (gen_random_uuid(), 'RESTAURANT', 'address:read'),
  (gen_random_uuid(), 'RESTAURANT', 'address:write'),
  (gen_random_uuid(), 'RESTAURANT', 'wallet:read'),
  (gen_random_uuid(), 'RESTAURANT', 'transaction:read'),
  (gen_random_uuid(), 'RESTAURANT', 'store:read'),
  (gen_random_uuid(), 'RESTAURANT', 'store:write'),
  (gen_random_uuid(), 'RESTAURANT', 'product:read'),
  (gen_random_uuid(), 'RESTAURANT', 'product:write'),
  (gen_random_uuid(), 'RESTAURANT', 'category:write'),
  (gen_random_uuid(), 'RESTAURANT', 'order:read'),
  (gen_random_uuid(), 'RESTAURANT', 'order:manage'),
  (gen_random_uuid(), 'MARKET_OPERATOR', 'address:read'),
  (gen_random_uuid(), 'MARKET_OPERATOR', 'address:write'),
  (gen_random_uuid(), 'MARKET_OPERATOR', 'wallet:read'),
  (gen_random_uuid(), 'MARKET_OPERATOR', 'transaction:read'),
  (gen_random_uuid(), 'MARKET_OPERATOR', 'store:read'),
  (gen_random_uuid(), 'MARKET_OPERATOR', 'store:write'),
  (gen_random_uuid(), 'MARKET_OPERATOR', 'product:read'),
  (gen_random_uuid(), 'MARKET_OPERATOR', 'product:write'),
  (gen_random_uuid(), 'MARKET_OPERATOR', 'category:write'),
  (gen_random_uuid(), 'MARKET_OPERATOR', 'order:read'),
  (gen_random_uuid(), 'MARKET_OPERATOR', 'order:manage'),
  (gen_random_uuid(), 'COFFEE_BRANCH', 'address:read'),
  (gen_random_uuid(), 'COFFEE_BRANCH', 'wallet:read'),
  (gen_random_uuid(), 'COFFEE_BRANCH', 'transaction:read'),
  (gen_random_uuid(), 'COFFEE_BRANCH', 'store:read'),
  (gen_random_uuid(), 'COFFEE_BRANCH', 'product:read'),
  (gen_random_uuid(), 'COFFEE_BRANCH', 'product:write'),
  (gen_random_uuid(), 'COFFEE_BRANCH', 'order:read'),
  (gen_random_uuid(), 'COFFEE_BRANCH', 'order:manage'),
  (gen_random_uuid(), 'DICLEFUL_OPERATOR', 'user:read'),
  (gen_random_uuid(), 'DICLEFUL_OPERATOR', 'address:read'),
  (gen_random_uuid(), 'DICLEFUL_OPERATOR', 'wallet:read'),
  (gen_random_uuid(), 'DICLEFUL_OPERATOR', 'transaction:read'),
  (gen_random_uuid(), 'DICLEFUL_OPERATOR', 'delivery:read'),
  (gen_random_uuid(), 'DICLEFUL_DRIVER', 'address:read'),
  (gen_random_uuid(), 'DICLEFUL_DRIVER', 'wallet:read'),
  (gen_random_uuid(), 'DICLEFUL_DRIVER', 'delivery:read'),
  (gen_random_uuid(), 'LOAD_CUSTOMER', 'address:read'),
  (gen_random_uuid(), 'LOAD_CUSTOMER', 'address:write'),
  (gen_random_uuid(), 'LOAD_CUSTOMER', 'wallet:read'),
  (gen_random_uuid(), 'LOAD_CUSTOMER', 'transaction:read'),
  (gen_random_uuid(), 'CARRIER', 'address:read'),
  (gen_random_uuid(), 'CARRIER', 'wallet:read'),
  (gen_random_uuid(), 'CARRIER', 'transaction:read');

-- DOGRULAMA: yazilan satir sayilari koddaki matrisle ayni olmali. Tutmuyorsa
-- migration ISTISNA atar ve transaction geri alinir - tablolar olusmaz, canli
-- veri oldugu gibi kalir (A1'deki ayni koruma).
DO $$
DECLARE
  izin_sayisi BIGINT;
  cift_sayisi BIGINT;
  yetim       BIGINT;
BEGIN
  SELECT count(*) INTO izin_sayisi FROM "permissions";
  SELECT count(*) INTO cift_sayisi FROM "role_permissions";
  IF izin_sayisi <> 28 THEN
    RAISE EXCEPTION 'permissions backfill tutmadi: beklenen 28, yazilan %', izin_sayisi;
  END IF;
  IF cift_sayisi <> 113 THEN
    RAISE EXCEPTION 'role_permissions backfill tutmadi: beklenen 113, yazilan %', cift_sayisi;
  END IF;
  -- FK zaten engelliyor; yine de acik kontrol: tanimsiz izne atama kalmasin.
  SELECT count(*) INTO yetim FROM "role_permissions" rp
    LEFT JOIN "permissions" p ON p."key" = rp."permissionKey" WHERE p."key" IS NULL;
  IF yetim <> 0 THEN
    RAISE EXCEPTION 'role_permissions icinde tanimsiz izin var: %', yetim;
  END IF;
END $$;
