-- FAZ 1 / A1 — ROL ATAMASI TABLOYA TASINDI (users.roles -> user_roles)
--
-- Neden: kapsam (hangi magazada gecerli) bir enum DIZISI kolonuna yazilamaz.
-- C adiminda gelecek "mutfak personeli yalnizca su subede" kurali storeId'de
-- yasayacak. A1'de storeId HER SATIRDA NULL = platform geneli, yani bugunku
-- davranisin birebir aynisi.
--
-- users.roles KOLONU DUSURULUYOR. Birakilsaydi sessiz ikinci kaynak olurdu;
-- dusurulunce kacan her okuma noktasi DERLEME HATASI verir (Prisma client'ta
-- User.roles kalmaz), yani tsc deploydan once yakalar.
--
-- VERI KAYBI KORUMASI: once kopyalanir, sonra SAYIM DOGRULANIR, en son
-- dusurulur. Sayim tutmazsa migration ISTISNA atar ve transaction geri alinir -
-- kolon dusmez, canli veri oldugu gibi kalir.

CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "storeId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_roles_userId_role_storeId_key" ON "user_roles"("userId", "role", "storeId");
CREATE INDEX "user_roles_userId_idx" ON "user_roles"("userId");
CREATE INDEX "user_roles_storeId_idx" ON "user_roles"("storeId");

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BACKFILL: dizinin her elemani bir satir. DISTINCT: ayni rol diziye iki kez
-- yazilmis olabilir, tekil indeks bunu reddederdi.
INSERT INTO "user_roles" ("id", "userId", "role", "storeId", "createdAt")
SELECT gen_random_uuid(), u."id", r, NULL, now()
FROM "users" u, LATERAL unnest(u."roles") AS r
GROUP BY u."id", r;

-- DOGRULAMA: tasinan satir sayisi, dizilerdeki TEKIL (kullanici, rol) ciftlerinin
-- sayisina esit olmali. Tutmuyorsa dur - kolon dusurulmez.
DO $$
DECLARE
  beklenen BIGINT;
  yazilan  BIGINT;
BEGIN
  SELECT count(*) INTO beklenen FROM (
    SELECT DISTINCT u."id", r FROM "users" u, LATERAL unnest(u."roles") AS r
  ) t;
  SELECT count(*) INTO yazilan FROM "user_roles";
  IF beklenen <> yazilan THEN
    RAISE EXCEPTION 'user_roles backfill tutmadi: beklenen %, yazilan %', beklenen, yazilan;
  END IF;
END $$;

ALTER TABLE "users" DROP COLUMN "roles";
