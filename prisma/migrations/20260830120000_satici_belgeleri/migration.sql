-- ADIM 01 — SATICI KYC BELGELERI (ADDITIVE)
--
-- Mevcut hicbir tablo/kolon DEGISMIYOR: iki yeni enum + bir yeni tablo.
-- sellers tablosuna kolon EKLENMEDI; iliski satici_belgeleri.sellerId
-- uzerinden kurulur (Prisma tarafindaki Seller.belgeler sanal alandir).
--
-- AYRI ENUM, LoadBelgeTipi ORTAK KULLANILMADI: o liste tasimaciliga ozgu
-- (EHLIYET, SRC, K_BELGE, ARAC_RUHSAT) ve satici icin anlamsiz. Ortak enum
-- iki tarafin listesini birbirine kilitlerdi.
--
-- VERGI NO icin ayri dogrulama kolonu ACILMADI: "dogrulandi" durumu
-- VERGI_LEVHASI belgesinin ONAYLANDI'ya alinmasidir ve sonuc mevcut
-- sellers.verification kolonuna yazilir. Ikinci bir kaynak tutulmaz.
--
-- ENUM/TABLO AYNI DOSYADA KALABILIR: buradaki enum'lar YENI olusturuluyor
-- (CREATE TYPE), mevcut bir tipe ALTER TYPE ... ADD VALUE yapilmiyor.
-- Kuyruk migration'inin uce bolunme sebebi orada gecerliydi, burada degil.

CREATE TYPE "SaticiBelgeTipi" AS ENUM ('VERGI_LEVHASI', 'IMZA_SIRKULERI', 'TICARET_SICIL_GAZETESI', 'FAALIYET_BELGESI', 'KIMLIK', 'IBAN_BELGESI', 'DIGER');

CREATE TYPE "SaticiBelgeDurum" AS ENUM ('BEKLIYOR', 'ONAYLANDI', 'REDDEDILDI');

CREATE TABLE "satici_belgeleri" (
    "id" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "tip" "SaticiBelgeTipi" NOT NULL,
    "dosyaUrl" TEXT NOT NULL,
    "durum" "SaticiBelgeDurum" NOT NULL DEFAULT 'BEKLIYOR',
    "redGerekce" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "satici_belgeleri_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "satici_belgeleri_sellerId_idx" ON "satici_belgeleri"("sellerId");

-- Admin inceleme kuyrugu BEKLIYOR uzerinden sorgulanir.
CREATE INDEX "satici_belgeleri_durum_idx" ON "satici_belgeleri"("durum");

-- ON DELETE RESTRICT: belge, saticinin KYC kanitidir. Satici kaydi zaten
-- deletedAt ile yumusak siliniyor; sert silme olsaydi kanit da yok olurdu.
ALTER TABLE "satici_belgeleri" ADD CONSTRAINT "satici_belgeleri_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
