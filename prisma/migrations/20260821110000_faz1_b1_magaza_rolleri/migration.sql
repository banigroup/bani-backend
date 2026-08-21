-- FAZ 1 / B1 adim 1 — MAGAZA KADROSU ROLLERI (enum degerleri)
--
-- C2'nin deseninin aynisi: yalnizca Role enum'una deger ekler. Hicbir SATIR
-- yazmaz, hicbir kisit eklemez, hicbir veri tasimaz.
--
-- MIGRATION NEDEN IKIYE BOLUNDU: Postgres'te ALTER TYPE ... ADD VALUE ile
-- eklenen deger AYNI TRANSACTION icinde KULLANILAMAZ. Bu rollerin izinleri
-- (role_permissions satirlari) o degerleri kullanmak zorunda oldugu icin ayri
-- bir migration'a alindi: 20260821110001_faz1_b1_magaza_izinleri.
-- C2'de bu bolme gerekmemisti (orada izin satiri yazilmiyordu).

ALTER TYPE "Role" ADD VALUE 'STORE_KITCHEN';
ALTER TYPE "Role" ADD VALUE 'STORE_CASHIER';
ALTER TYPE "Role" ADD VALUE 'STORE_STOCK';
