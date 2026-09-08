// ENTEGRASYON TEST RUNNER (D136) — GERCEK PostgreSQL GEREKTIRIR.
//
// NEDEN AYRI CONFIG: birim runner (jest.config.js) hem CI'da hem de production
// imaj build'inde (Dockerfile, D130 kapisi) kosuyor ve iki baglamda da veritabani
// YOK. DB gerektiren testleri o runner'a sokmak, production imajinin uretilmesini
// bir veritabanina bagimli hale getirirdi. Bu yuzden ayrim CONFIG duzeyinde.
//
// CIFT YONLU AYRIM:
//   · burasi YALNIZ '*.int.spec.ts' toplar
//   · jest.config.js ayni deseni testPathIgnorePatterns ile DISLAR
// Tek yonlu bir ayrim yeterli olmazdi: '.int.spec.ts' birim testRegex'ine de uyar.
//
// CALISTIRMA: `pnpm run test:int` + INTEGRATION_DATABASE_URL (bani_test).
// Env yoksa test dosyasi FAIL-CLOSED davranir; development/production DATABASE_URL
// fallback olarak KULLANILMAZ.
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.int\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testEnvironment: 'node',

  // SERI CALISMA (§11): ayri Jest worker'lari ayni fixture'lari ezmesin. Testin
  // KENDI icindeki eszamanlilik bundan ETKILENMEZ - yaris, tek surecte acilan
  // birden fazla gercek PostgreSQL transaction'i arasinda kuruluyor.
  maxWorkers: 1,

  // Varsayilan 5 sn YETMEZ: kaybeden transaction, kazanan commit edene kadar
  // gercek bir satir kilidinde BEKLER. Bu bir sleep degil, olcmek istedigimiz
  // davranisin ta kendisi; yine de CI gurultusune karsi genis pay birakiliyor.
  testTimeout: 60000,
};
