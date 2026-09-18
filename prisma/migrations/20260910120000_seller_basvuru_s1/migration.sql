-- S1 — SATICI BASVURUSU: SEMA + DURUM + IZIN (ADDITIVE)
--
-- Bu migration YALNIZCA veri yapisini hazirlar. Hicbir uc, hicbir is kurali,
-- hicbir durum gecisi bu pakette DEGISMEZ:
--   - POST /market/seller ucu S2'de
--   - basvuru uclarinin izni SELLER_APPLY'a S3'te cevrilir
--   - REJECTED gecis kurali S4'te seller-status.service'e yazilir
--   - businessUnit yazma / Store zamanlamasi S5'te
-- Dolayisiyla bu migration canliya gitse bile DAVRANIS DEGISMEZ: yeni kolonlar
-- bos, yeni enum degeri kullanilmiyor, yeni izin hicbir uca bagli degil.
--
-- ==========================================================================
-- M2 — SellerStatus += REJECTED
-- ==========================================================================
--
-- NEDEN ONCE: asagidaki hicbir ifade bu degeri KULLANMIYOR. Postgres kurali
-- (PG 12+): ALTER TYPE ... ADD VALUE transaction blogu icinde calisir - Prisma
-- migration'lari transaction ile sarar - ama eklenen deger AYNI transaction
-- icinde KULLANILAMAZ. Burada yalnizca ekleniyor, guvenli.
-- (Ayni gerekce: 20260814120000_partner_basvuru_dicleful.)
--
-- GERI ALMA YOK: Postgres enum'dan deger SILMEYI desteklemez. Geri alinmasi
-- gerekirse tip yeniden olusturulur (CREATE TYPE yeni; ALTER COLUMN ... USING;
-- DROP TYPE eski). Bu yuzden 'REJECTED' adi migration yazilmadan ONCE
-- kilitlendi (owner karari D8).
--
-- NEEDS_FIX'TEN AYRI: NEEDS_FIX "duzelt ve tekrar gonder", REJECTED "inceleme
-- olumsuz". Tek degere sikistirilsaydi panel ikisine ayni ekrani gosterirdi.
ALTER TYPE "SellerStatus" ADD VALUE 'REJECTED';

-- ==========================================================================
-- M1 — Seller basvuru kolonlari (HEPSI NULLABLE)
-- ==========================================================================
--
-- BACKFILL YOK: dordu de NULL kabul ediyor, dolayisiyla mevcut Seller
-- satirlari oldugu gibi gecerli kalir. Iki asamali migration GEREKMEZ.
--
-- UNIQUE YOK (basvuruEposta icin owner karari OD-4): bu bir ILETISIM alani,
-- kimlik degil. Danisman ya da grup sirketi ayni adresi birden fazla
-- isletmede mesru olarak kullanabilir. User.email @unique davranisi buraya
-- TASINMIYOR. Sonradan UNIQUE eklemek kolay, kaldirmak migration ister.
--
-- INDEX YOK: bu kolonlarin hicbiri bugun sorgu kosulu degil. Ihtiyac dogunca
-- olculerek eklenir - kullanilmayan index yazma maliyeti demektir.
ALTER TABLE "sellers" ADD COLUMN "yetkiliAdSoyad"   TEXT;
ALTER TABLE "sellers" ADD COLUMN "basvuruEposta"    TEXT;
ALTER TABLE "sellers" ADD COLUMN "redGerekce"       TEXT;
ALTER TABLE "sellers" ADD COLUMN "talepEdilenDikey" "BusinessUnit";

-- ==========================================================================
-- M3 — AKTIF SATICI TEKILLIGI (kismi unique index)
-- ==========================================================================
--
-- KURAL (owner karari OD-6): bir kullanicinin ayni anda EN FAZLA BIR aktif
-- satici kaydi olur. Bugun bunu engelleyen hicbir sey yok; es zamanli iki
-- istek iki Seller yaratabilirdi.
--
-- KAPSAM deletedAt IS NULL: soft-delete edilmis kayitlar disarida kalir, yani
-- kaydi silinen kullanici YENIDEN basvurabilir. Kosul kaldirilsaydi silinmis
-- bir kayit kullaniciyi kalici olarak kilitlerdi.
--
-- RAW SQL: Prisma schema DSL'i kismi (WHERE'li) unique index'i ifade EDEMIYOR.
-- Emsal ve ayni gerekce: 20260907010725_approval_active_pending_unique
-- (change_requests_active_pending_target_key).
--
-- CANLI ON KONTROL YAPILDI: uretim veritabaninda deletedAt IS NULL olan
-- satirlar ownerUserId bazinda gruplandi -> mukerrer 0. Index dusmez.
CREATE UNIQUE INDEX "sellers_active_owner_key"
  ON "sellers" ("ownerUserId")
  WHERE "deletedAt" IS NULL;

-- ==========================================================================
-- M4 — seller:apply IZNI
-- ==========================================================================
--
-- SIRA ONEMLI: role_permissions."permissionKey" -> permissions."key" FOREIGN
-- KEY tasiyor. Anahtar once permissions'a girmezse asagidaki INSERT FK
-- ihlaliyle duser.
--
-- ON CONFLICT: migration'lar bir kez calisir, ama role_permissions PANELDEN de
-- yazilabiliyor (superadmin/izin-yonetim.service). Bu satirlar migration'dan
-- once elle eklenmis olsaydi migration duserdi; DO NOTHING o yolu kapatir ve
-- mevcut satiri EZMEZ.
INSERT INTO "permissions" ("key", "description") VALUES
  ('seller:apply', 'Satici basvurusu olusturma/duzenleme (kendi kaydi)')
  ON CONFLICT ("key") DO NOTHING;

-- CUSTOMER: yeni kullanicinin basvuruyu BASLATABILMESI icin. Bugun CUSTOMER'da
--   store:read VAR (okuma uclari zaten calisiyor) ama store:write YOK - yani
--   basvurunun yazma tarafi tamamen kapali. Bu satir o kapiyi acar.
-- MERCHANT: REGRESYON KORUMASI. Bes basvuru ucu bugun STORE_WRITE ile korunuyor
--   ve MERCHANT'in STORE_WRITE'i var. S3'te izin SELLER_APPLY'a cevrilecegi
--   icin bu satir OLMAZSA mevcut saticilar kendi KYC'sini yonetemez hale
--   gelir. Satir S3'ten ONCE giriyor ki iki paket arasinda bosluk olusmasin.
--
-- ADMIN / SUPER_ADMIN'e VERILMEDI - tahmin degil, kanit: PermissionsGuard'da
--   wildcard ya da super-rol atlamasi YOK (izin tamamen role_permissions'tan
--   okunuyor; SUPER_ADMIN'in 29 izni de acik satir). Kapsamdaki bes uc
--   saticinin KENDI kaydi uzerinde calisiyor (saticimHam(user.id)); admin'in
--   satici kaydi olmadigi icin bu uclar onlara bugun de 404 donuyor. Admin'in
--   satici yonetimi AYRI uclardan yuruyor (/market/sellers/*, STORE_MANAGE_ALL)
--   ve bu pakette DEGISMIYOR. Ihtiyac dogmadan izin genisletmemek repo
--   disiplini (bkz. permissions.enum.ts PERMISSION_MANAGE notu).
INSERT INTO "role_permissions" ("id", "role", "permissionKey") VALUES
  (gen_random_uuid(), 'CUSTOMER', 'seller:apply'),
  (gen_random_uuid(), 'MERCHANT', 'seller:apply')
  ON CONFLICT ("role", "permissionKey") DO NOTHING;
