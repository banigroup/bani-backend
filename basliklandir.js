const fs = require("fs");
const p = "src/load/load.service.ts";
let s = fs.readFileSync(p, "utf8");

// Her biri: [mevcut satır (dosyada birebir), yeni baslik]
const D = "\u2588\u2588\u2588\u2588\u2588\u2588";
const rep = [
  ["  // ============ YUK ILANI (yuk veren) ============",
   `  // ${D} 1 \u00b7 YUK ILANI (yuk veren) ${D}`],
  ["  // ===== ILAN BORSASI (public, sayfali, filtreli) =====",
   `  // ${D} 2 \u00b7 VITRIN / ILAN BORSASI (public) ${D}`],
  ["  // ============ ARAC ILANI (tasiyici) ============",
   `  // ${D} 3 \u00b7 ARAC ILANI (tasiyici) ${D}`],
  ["  // ============ ARAC TEKLIF SISTEMI (firma -> arac, kamyoncu onaylar) ============",
   `  // ${D} 4 \u00b7 ARAC TEKLIF (firma -> arac, kamyoncu onaylar) ${D}`],
  ["  // ============ TEKLIF (tasiyici verir) ============",
   `  // ${D} 5 \u00b7 YUK TEKLIF (tasiyici verir + kabul + pazarlik) ${D}`],
  ["  // ============ IS AKISI: tasima basla / tamamla (+%5 komisyon) ============",
   `  // ${D} 6 \u00b7 IS AKISI: tasima basla / tamamla (+%5 komisyon) ${D}`],
  ["  // KOMISYON BORC + TAHSILAT (Faz 1: havale + admin onayi)",
   `  // ${D} 7 \u00b7 KOMISYON BORC + TAHSILAT (havale + admin onayi) ${D}\n  // Faz 1: havale + admin onayi`],
  ["  // SOZLESME ONAY (B modeli: uyelikte tek onay + is delili)",
   `  // ${D} 8 \u00b7 SOZLESME + KYC (profil/belge) + ADMIN ${D}\n  // SOZLESME ONAY (B modeli: uyelikte tek onay + is delili)`],
  ["  // ===== DEGERLENDIRME (puanlama - is TAMAMLANDI sonrasi, cift yonlu, 1-5) =====",
   `  // ${D} 9 \u00b7 DEGERLENDIRME (puanlama, cift yonlu 1-5) ${D}`],
];

let deg = 0, atla = [];
for (const [eski, yeni] of rep) {
  if (s.includes(yeni.split("\n")[0])) { atla.push("zaten: " + yeni.split(D)[1].trim()); continue; }
  if (s.includes(eski)) { s = s.replace(eski, yeni); deg++; }
  else { atla.push("BULUNAMADI: " + eski.trim().slice(0,40)); }
}

fs.writeFileSync(p, s);
console.log("Degistirilen baslik: " + deg + " / " + rep.length);
if (atla.length) console.log("Notlar:\n - " + atla.join("\n - "));
