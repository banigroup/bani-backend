-- ADIM 01 — SOZLESME TIPI: SATICI TARAFI (ADDITIVE)
--
-- Yalnizca iki yeni enum degeri. Tablo, kolon, kisit DEGISMIYOR; mevcut
-- sozlesme_onaylari / sozlesme_versiyonlari satirlarina dokunulmuyor.
--
-- IKI TIP, TEK TIP DEGIL: uyelik metni nadiren, komisyon sartlari sik degisir.
-- Tek tip olsaydi her komisyon orani degisikligi uyelik sozlesmesinin de
-- yeniden onaylanmasini gerektirirdi - SozlesmeVersiyon tip basina TEK aktif
-- surum tutuyor (@@unique([tip, surum]) + aktif bayragi).
--
-- TEK DOSYA YETERLI: kuyruk migration'i uce bolunmustu cunku eklenen enum
-- degeri AYNI transaction icinde backfill'de KULLANILIYORDU. Burada deger
-- yalnizca ekleniyor, hicbir DML onu okumuyor.
--
-- BU MIGRATION SOZLESME METNI YARATMAZ. sozlesme_versiyonlari'na SATICI ve
-- SATICI_KOMISYON icin aktif surum satiri girilene kadar ilgili uclar
-- SozlesmeService.aktifVersiyon uzerinden 503 doner ("aktif surum tanimli
-- degil"). Bu BILINCLI: metin/surum girisi hukuk onayina bagli ayri bir is ve
-- veri yazma islemi oldugu icin bu migration'a dahil edilmedi.

ALTER TYPE "SozlesmeTipi" ADD VALUE 'SATICI';
ALTER TYPE "SozlesmeTipi" ADD VALUE 'SATICI_KOMISYON';
