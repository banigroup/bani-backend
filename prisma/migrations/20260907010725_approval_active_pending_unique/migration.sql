-- D118 — ACTIVE PENDING CONCURRENCY (owner-approved)
--
-- KURAL: ayni approval hedefi icin en fazla BIR aktif PENDING ChangeRequest.
-- HEDEF KIMLIGI (D115 dogrulamasi): (entityType, entityId).
--   entityType KIMLIGE DAHIL (StoreHour/DeliveryZone ayni storeId'yi entityId
--   olarak tasir; tipler yalniz entityType ile ayrisir).
--   actionType / storeId / businessUnit KIMLIGE DAHIL DEGIL.
-- KAPSAM: yalnizca status=PENDING VE entityId NOT NULL satirlar.
--   CREATE (entityId=NULL) BILEREK KAPSAM DISI (CREATE_SUPERSEDE_IDENTITY ayri, cozulmedi).
--
-- Prisma schema DSL kismi (WHERE) unique index'i ifade edemedigi icin RAW SQL.
-- ADDITIVE: yalnizca yeni kismi unique index olusturur; tablo/veri/Step1 migration DEGISMEZ.
CREATE UNIQUE INDEX "change_requests_active_pending_target_key"
  ON "change_requests" ("entityType", "entityId")
  WHERE "status" = 'PENDING'::"ChangeRequestStatus" AND "entityId" IS NOT NULL;
