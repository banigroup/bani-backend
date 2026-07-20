-- FAZ 1: sozlesme versiyonlari cekirdek tabloya (gecerli surum kod sabitinden DB'ye)
-- SozlesmeOnay'a DOKUNULMAZ - sifir veri riski. Tohum: mevcut v1-taslak surumleri, kodun urettigi hash'lerle.

CREATE TABLE "sozlesme_versiyonlari" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tip" "SozlesmeTipi" NOT NULL,
    "surum" TEXT NOT NULL,
    "metinHash" TEXT NOT NULL,
    "yururlukTarihi" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktif" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "sozlesme_versiyonlari_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sozlesme_versiyonlari_tip_surum_key" ON "sozlesme_versiyonlari"("tip", "surum");
CREATE INDEX "sozlesme_versiyonlari_tip_aktif_idx" ON "sozlesme_versiyonlari"("tip", "aktif");

INSERT INTO "sozlesme_versiyonlari" ("tip", "surum", "metinHash", "aktif") VALUES
('TASIYICI', 'v1-taslak', '746dc91b14d5424a29c3ad6c9cfe5c4f05de4453d9a7d812ce356dae568ea989', true),
('YUK_VEREN', 'v1-taslak', 'cf1c725e2958f20d70fd9611a831011ac69f0809dfad24833cd09d82e4a11829', true);