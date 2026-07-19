// Birim siniri denetimi (v6 Faz 0): birim, baska birimin koduna dokunamaz.
// load & sigorta: izole. Banigo ticaret kumesi (market/catalog/cart/orders/delivery/takip): kendi icinde serbest.
// Cekirdek (prisma/auth/common/finance/users/notification/superadmin/partner): herkes tuketebilir.
const fs = require('fs'); const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const UNITS = ['load', 'sigorta', 'market', 'catalog', 'cart', 'orders', 'delivery', 'takip'];
const COMMERCE = new Set(['market', 'catalog', 'cart', 'orders', 'delivery', 'takip']);
let errors = [];
function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.ts$/.test(e.name)) check(p); } }
function check(file) {
  const u = path.relative(SRC, file).split(path.sep)[0];
  if (!UNITS.includes(u)) return;
  const s = fs.readFileSync(file, 'utf8');
  const re = /from\s+['"]([^'"]+)['"]/g; let m;
  while ((m = re.exec(s))) {
    const imp = m[1]; if (!imp.startsWith('.')) continue;
    const rel = path.relative(SRC, path.resolve(path.dirname(file), imp));
    if (rel.startsWith('..')) continue;
    const tu = rel.split(path.sep)[0];
    if (UNITS.includes(tu) && tu !== u && !(COMMERCE.has(u) && COMMERCE.has(tu))) {
      errors.push(path.relative(SRC, file) + ' -> src/' + tu + ' (birim siniri ihlali)');
    }
  }
}
walk(SRC);
if (errors.length) { console.error('SINIR IHLALI:\n' + errors.join('\n')); process.exit(1); }
console.log('Birim sinirlari temiz.');