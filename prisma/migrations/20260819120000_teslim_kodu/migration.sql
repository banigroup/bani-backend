-- TESLIM KANITI: tek kullanimlik teslim kodu
-- ============================================================================
-- deliver() bugun kuryenin tek tikiyla siparisi DELIVERED yapip escrow'u
-- dagitiyor; teslimin gerceklestigine dair hicbir delil tutulmuyor. Bu kolonlar
-- musteriye bildirilen 6 haneli kodu, dogrulama damgasini ve hatali deneme
-- sayacini tasir.
--
-- teslimKod NULLABLE: mevcut kayitlarda kod yoktu. NOT NULL + sabit DEFAULT
-- vermek "herkeste ayni kod" demek olurdu - dogrulamayi bastan anlamsiz kilardi.
-- Kodu olmayan teslimat deliver() tarafindan REDDEDILIR (sessizce dagitim YOK).
-- unique DEGIL: 6 hanede cakisma normaldir; unique olsa uretim rastgele patlardi.
-- ============================================================================

ALTER TABLE "deliveries" ADD COLUMN "teslimKod" TEXT;
ALTER TABLE "deliveries" ADD COLUMN "teslimKodDogrulandiAt" TIMESTAMP(3);
ALTER TABLE "deliveries" ADD COLUMN "teslimKodDeneme" INTEGER NOT NULL DEFAULT 0;

-- BACKFILL: halen akistaki teslimatlara kod uretilir (canli: 26 kayit, hepsi
-- PENDING). Teslim edilmis/iptal olmus kayitlara kod YAZILMAZ - onlarin akisi
-- bitti, kod uretmek yaniltici iz birakirdi.
--
-- Rastgelelik kaynagi gen_random_uuid(): random() oturum basina tohumlanan bir
-- PRNG, uuid ise guclu kaynaktan gelir. md5'in ilk 8 hex hanesi bit(32)'ye,
-- oradan bigint'e cevrilir (isaretsiz: 0..4294967295 - yerelde 20000 uretimle
-- dogrulandi, negatif yok), mod 1e6 ile 6 haneye indirilir, lpad ile basa sifir.
-- gen_random_uuid() volatile oldugu icin HER SATIR kendi degerini alir.
UPDATE "deliveries"
SET "teslimKod" = lpad((mod(('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::bigint, 1000000))::text, 6, '0')
WHERE "teslimKod" IS NULL
  AND "status" NOT IN ('DELIVERED', 'CANCELLED');
