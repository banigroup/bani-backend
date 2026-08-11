-- ELLE YAZILMIS MIGRATION (Prisma semasi kismi/partial index ifade edemez).
--
-- SORUN: Sistem cuzdanlari (PLATFORM / ESCROW) tekil olmali, ama mevcut
--   @@unique([userId, type, currency]) kisiti onlari KORUMUYOR. getSystemWallet
--   bu cuzdanlari userId = NULL ile yaratiyor; Postgres'te NULL != NULL kabul
--   edildigi icin unique kisit NULL'li satirlara hic uygulanmiyor. Iki es zamanli
--   istek iki ayri ESCROW cuzdani dogurabilir; sonrasinda findFirst hangisini
--   dondurecegi belirsiz olur ve escrow bakiyesi ikiye bolunur.
--
-- COZUM: Sistem tipleri icin type+currency uzerinde KISMI unique index.
--   Kismi olmak zorunda: ayni tabloda USER cuzdanlari da var ve onlarda
--   ayni type+currency her kullanici icin tekrar eder.
--   userId'ye BAKILMAZ - cunku kod (getSystemWallet) sistem cuzdanini zaten
--   yalnizca type+currency ile ariyor. Canlida PLATFORM cuzdaninin userId'si
--   seed'den dolu, ESCROW'unki NULL; bu index ikisini de kapsar.
--
-- VERIYE ETKISI: YOK. Sadece index olusturur; ALTER/UPDATE/DELETE icermez.
--   Her tipten halihazirda tek satir bulundugu icin kisit aninda saglanir.
--   Geri alma: DROP INDEX "wallets_sistem_tip_para_key";

CREATE UNIQUE INDEX "wallets_sistem_tip_para_key"
  ON "wallets" ("type", "currency")
  WHERE "type" IN ('PLATFORM', 'ESCROW');
