// Birim siniri denetimi (v6 Faz 0): birim, baska birimin koduna dokunamaz.
// load & sigorta: izole. Banigo ticaret kumesi (market/catalog/cart/orders/delivery/takip): kendi icinde serbest.
// Cekirdek (prisma/auth/common/finance/users/notification/superadmin/partner/holding): herkes tuketebilir.
//
// HOLDING NEDEN CEKIRDEKTE (Faz 0 / paket 2): src/holding, dikeyler arasini
// okumasi BEKLENEN tek katmandir - muafiyeti kaza degil karardir. Onu bir UNIT
// saymak yaniltici bir koruma olurdu: bu betik yalnizca TS import yollarina
// bakar, prisma.order / prisma.store erisimini goremez; holding'in asil
// capraz-dikey temasi ise Prisma uzerindendir.
//
// TEK YONLU KURAL: holding cekirdek gibi TUKETILEBILIR ama kendisi hicbir
// dikeyin KODUNA dokunamaz (asagidaki CEKIRDEK_KISITLI). Rapor mantigi bir
// dikeyin servisine baglanirsa fiziksel ayrimda o baglanti kopar - o yuzden
// holding yalnizca Prisma ve cekirdek uzerinden beslenir.
const fs = require('fs'); const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const UNITS = ['load', 'sigorta', 'market', 'catalog', 'cart', 'orders', 'delivery', 'takip'];
const COMMERCE = new Set(['market', 'catalog', 'cart', 'orders', 'delivery', 'takip']);
// Cekirdekte ama TEK YONLU: baskasi bunlari import edebilir, bunlar hicbir UNIT'i edemez.
const CEKIRDEK_KISITLI = ['holding'];
let errors = [];
function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.ts$/.test(e.name)) check(p); } }
function check(file) {
  const u = path.relative(SRC, file).split(path.sep)[0];
  const kisitli = CEKIRDEK_KISITLI.includes(u);
  if (!UNITS.includes(u) && !kisitli) return;
  const s = fs.readFileSync(file, 'utf8');
  const re = /from\s+['"]([^'"]+)['"]/g; let m;
  while ((m = re.exec(s))) {
    const imp = m[1]; if (!imp.startsWith('.')) continue;
    const rel = path.relative(SRC, path.resolve(path.dirname(file), imp));
    if (rel.startsWith('..')) continue;
    const tu = rel.split(path.sep)[0];
    if (kisitli) {
      // Tek yonlu kural: holding hicbir dikeyin koduna dokunamaz.
      if (UNITS.includes(tu)) {
        errors.push(path.relative(SRC, file) + ' -> src/' + tu + ' (holding bir dikeyin koduna dokunamaz)');
      }
      continue;
    }
    if (UNITS.includes(tu) && tu !== u && !(COMMERCE.has(u) && COMMERCE.has(tu))) {
      errors.push(path.relative(SRC, file) + ' -> src/' + tu + ' (birim siniri ihlali)');
    }
  }
}
walk(SRC);
if (errors.length) { console.error('SINIR IHLALI:\n' + errors.join('\n')); process.exit(1); }
console.log('Birim sinirlari temiz.');