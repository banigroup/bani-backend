-- KUYRUK DIKEY ALANI 2/3 — kolon ve indeks
--
-- NULLABLE ve DEFAULT YOK: Cart.businessUnit'teki bilincli desen ("dikey her
-- yaratmada acikca verilsin, unutulan yer derlenmesin"). Kolonu hemen NOT NULL
-- yapmak, ayni anda KuyrukService.ekle()'nin imzasini degistirmeyi gerektirirdi;
-- nullable gecis cagri yerlerini tek tek donusturmeye izin veriyor.
--
-- DAVRANIS BU MIGRATION'DA DEGISMIYOR: kolon yaziliyor ama okuyan yok.
-- KuyrukService.sahiplen() bugun hala tipe/dikeye bakmadan en eski isi aliyor.

ALTER TABLE "is_kuyrugu" ADD COLUMN "businessUnit" "BusinessUnit";

-- Dikey filtreli isleyicinin tarayacagi yol: sahiplen() where'i
-- (businessUnit, durum, calistirZamani) uzerinden calisacak.
CREATE INDEX "is_kuyrugu_businessUnit_durum_calistirZamani_idx"
    ON "is_kuyrugu"("businessUnit", "durum", "calistirZamani");
