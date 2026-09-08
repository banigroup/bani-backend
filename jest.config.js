module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // D136 — ENTEGRASYON TESTLERI BU RUNNER'IN KAPSAMI DISINDA.
  //
  // NEDEN GEREKLI: '<ad>.int.spec.ts' yukaridaki testRegex'e MATEMATIKSEL OLARAK
  // UYAR ('.int' parcasini bastaki '.*' yutar). Ayrim yapilmazsa DB gerektiren
  // testler `pnpm test` ile birlikte hem CI'da (ci.yml) hem de production imaj
  // build'inde (Dockerfile, D130 kapisi) kosardi - iki baglamda da PostgreSQL YOK.
  //
  // NEDEN testRegex DEGISTIRILMEDI: o ifade D133 owner kararidir. Ayrim AYRI bir
  // anahtarla yapildi; D133'un kararladigi desen bit bit ayni kaldi.
  //
  // '/node_modules/' ACIKCA TEKRARLANDI: bu alan verildiginde Jest'in varsayilani
  // (['/node_modules/']) TAMAMEN yer degistirir, birlesmez.
  testPathIgnorePatterns: ['/node_modules/', '\\.int\\.spec\\.ts$'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  testEnvironment: 'node',
};
