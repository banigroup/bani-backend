-- D134 — DELIVERY-ZONE OPTIMISTIC REVISION (C3A-005 owner-approved)
--
-- KURAL: teslimat bolgesi listesi (magaza_teslimat_bolgeleri) BUTUN LISTE olarak
-- degistiriliyor. Karsilastirma ile yazim arasindaki TOCTOU penceresini kapatmak
-- icin listenin SAHIBINDE (stores) optimistic bir belirtec tutulur; tum yazicilar
-- ayni CAS protokolune katilir:
--   UPDATE stores SET "deliveryZoneRevision" = "deliveryZoneRevision" + 1
--   WHERE id = $1 AND "deliveryZoneRevision" = $2   -- count <> 1 => Conflict
--
-- NEDEN AYRI KOLON: stores.updatedAt bolge yaziminda degismiyor; genel bir
-- "version" ise ilgisiz yuzeyleri birbirine baglardi (bkz. schema yorumu).
--
-- ADDITIVE: yalnizca yeni kolon eklenir. Tablo/veri/index/FK DEGISMEZ.
-- NOT NULL + DEFAULT 0 -> PostgreSQL 11+ varsayilani katalogda tutar, TABLO
-- YENIDEN YAZILMAZ (yalnizca kisa ACCESS EXCLUSIVE metadata kilidi).
ALTER TABLE "stores"
  ADD COLUMN "deliveryZoneRevision" INTEGER NOT NULL DEFAULT 0;
