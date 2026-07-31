// Guard denetimi (P0-1 kaliciligi): hicbir HTTP ucu korumasiz kalamaz.
// Global JWT guard YOK -> her controller ucu ya @UseGuards ya @Public tasimali.
// Kural: bir controller metodu @Get/@Post/@Patch/@Put/@Delete tasiyorsa,
// o metodun VEYA sinifin uzerinde @UseGuards(...) VEYA metodun uzerinde @Public olmali.
// Amac: yeni bir uc korumasiz eklenirse CI kirilsin (P0-1 gibi aciklarin tekrari onlensin).
const fs = require('fs'); const path = require('path');
const SRC = path.join(__dirname, '..', 'src');
// Bilerek herkese acik controller'lar (vitrin/form/izleme) — sinif ici @Public de kullanilabilir.
const ACIK_CONTROLLER = new Set(['auth', 'health']);
const HTTP = /@(Get|Post|Patch|Put|Delete)\s*\(/;
let errors = [];
function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.controller\.ts$/.test(e.name)) check(p); } }
function check(file) {
  const s = fs.readFileSync(file, 'utf8');
  const rel = path.relative(SRC, file);
  const unit = rel.split(path.sep)[0];
  const sinifGuard = /@UseGuards\s*\(/.test(s.split(/export\s+class/)[0]); // sinif ustu @UseGuards
  const acikController = ACIK_CONTROLLER.has(unit);
  const lines = s.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!HTTP.test(lines[i])) continue;
    // bu metodun dekorator blogu: HTTP satirindan geriye dogru bitisik @... satirlari
    let bas = i; while (bas > 0 && /^\s*@/.test(lines[bas - 1])) bas--;
    // ileriye dogru: HTTP satiri + varsa devam eden @... satirlari (imza satirina kadar)
    let son = i; while (son + 1 < lines.length && /^\s*@/.test(lines[son + 1])) son++;
    const blok = lines.slice(bas, son + 1).join('\n');
    const korumali = /@UseGuards\s*\(/.test(blok) || /@Public\s*\(?/.test(blok) || sinifGuard || acikController;
    if (!korumali) {
      const m = lines[i].match(HTTP);
      errors.push(rel + ':' + (i + 1) + ' -> ' + (m ? m[0] : 'uc') + ' korumasiz (ne @UseGuards ne @Public)');
    }
  }
}
walk(SRC);
if (errors.length) { console.error('KORUMASIZ UC:\n' + errors.join('\n') + '\n\nHer uc @UseGuards(...) veya @Public tasimali. Bilerek acik ise @Public ekleyin.'); process.exit(1); }
console.log('Guard denetimi temiz — korumasiz uc yok.');
