-- 02 — SATICI_KOMISYON: EK-4 KOMISYON VE HIZMET BEDELI TARIFESI (AKTIF SURUM)
--
-- NE YAPAR: sozlesme_versiyonlari'na SATICI_KOMISYON tipi icin TEK bir aktif
-- surum satiri ekler. Tablo, kolon, kisit, enum DEGISMIYOR; yeni bir sozlesme
-- sistemi KURULMUYOR - mevcut model (tip + surum + metinHash + aktif) aynen
-- kullaniliyor.
--
-- NEDEN AYRI TIP, SATICI'NIN ICINDE DEGIL: Ana Sozlesme komisyon tarifesini
-- kendi eki olarak (Ek-4) ongoruyor ve tarife sik, uyelik metni nadir degisir.
-- 20260830130000_sozlesme_tipi_satici migration'inin basligindaki gerekce bu;
-- burada o gerekcenin veri tarafi tamamlaniyor.
--
-- METIN NEREDE: prisma/sozlesmeler/ek-4-komisyon-tarifesi.md (owner tarafindan
-- verilen kanonik metin). Bu tablo METIN TUTMAZ, yalnizca o metnin OZETINI
-- tutar - mevcut tasarim boyle (bkz. 20260720063339_faz1_sozlesme_versiyon).
--
-- HASH: asagidaki metinHash, o .md dosyasinin satir sonlari LF'e indirgenmis
-- UTF-8 baytlarinin SHA-256'sidir. Ayni kanoniklestirme frontend'in
-- kanonikMetin() fonksiyonunda da kullaniliyor; yeni bir hash standardi
-- URETILMEDI. Metin ile hash'in ayrisamayacagini src/sozlesme/
-- ek4-komisyon-tarifesi.spec.ts her kosuda dogrular (metin degisip hash
-- guncellenmezse test kirmizi olur).
--
-- IDEMPOTENT: (tip, surum) uzerinde UNIQUE index var
-- (sozlesme_versiyonlari_tip_surum_key). ON CONFLICT DO NOTHING ile ikinci
-- kosu hicbir sey yazmaz, hata da vermez.
--
-- BASKA SATIRA DOKUNMAZ: burada YALNIZCA INSERT var. Diger tiplerin (SATICI
-- dahil) aktif surumleri, mevcut onaylar ve SATICI v1.2 kaydi OLDUGU GIBI
-- kalir. Var olan bir satiri pasiflestiren bir UPDATE bilerek YAZILMADI -
-- bugun SATICI_KOMISYON tipinde baska satir yok ve ileride elle eklenmis bir
-- satiri sessizce kapatmak bu migration'in isi degil.

INSERT INTO "sozlesme_versiyonlari" ("tip", "surum", "metinHash", "aktif") VALUES
('SATICI_KOMISYON', 'v1.0-2026-09-21', '3bcfaf329154b94acc67b29214ac2e0fbc157bbc2af084158ad053fbf6c23e29', true)
ON CONFLICT ("tip", "surum") DO NOTHING;
