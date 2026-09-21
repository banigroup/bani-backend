// 02 — EK-4 KOMISYON TARIFESI: KANONIK METIN <-> MIGRATION HASH BAGI.
//
// NEDEN BU TEST VAR: sozlesme_versiyonlari METIN TUTMAZ, yalnizca metinHash.
// Metin repoda (.md), ozet ise migration'da duruyor. Biri degisip digeri
// guncellenmezse hicbir sey patlamaz - satici, GORDUGUNDEN BASKA bir metnin
// ozetini onaylamis olur. BaniLoad'da tam olarak bu sessiz tutarsizlik
// yasandi (bkz. frontend SozlesmeMetni.ts basligi). Bu paket o ayrismayi
// derleme/test zamaninda imkansiz kilar.
//
// KANONIKLESTIRME FRONTEND ILE AYNI: satir sonlari LF'e indirgenir, sonra
// UTF-8 baytlarin SHA-256'si alinir (kanonikMetin + sozlesmeMetinOzeti).
// Yeni bir hash standardi URETILMEDI. Depoda core.autocrlf=true oldugu icin
// bu indirgeme sart: ayni dosya Windows checkout'unda CRLF ile durur.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const KOK = join(__dirname, '..', '..');
const METIN_YOLU = join(KOK, 'prisma', 'sozlesmeler', 'ek-4-komisyon-tarifesi.md');
const MIGRATION_YOLU = join(
  KOK, 'prisma', 'migrations', '20260921090000_satici_komisyon_ek4_surumu', 'migration.sql',
);

const SURUM = 'v1.0-2026-09-21';

/** Frontend kanonikMetin() ile AYNI: yalnizca CRLF -> LF. */
function kanonikMetin(metin: string): string {
  return metin.replace(/\r\n/g, '\n');
}

function ozet(metin: string): string {
  return createHash('sha256').update(kanonikMetin(metin), 'utf8').digest('hex');
}

const metin = readFileSync(METIN_YOLU, 'utf8');
const migration = readFileSync(MIGRATION_YOLU, 'utf8');

describe('EK-4 kanonik metin', () => {
  it('UTF-8 bozulmamis (Turkce karakterler ve BANI yazimi yerinde)', () => {
    for (const parca of ['BÂNÎ GROUP', 'KOMİSYON', 'HİZMET', 'DOĞMASI', 'BÜTÜNLÜK', 'SÖZLEŞMEYLE']) {
      expect(metin).toContain(parca);
    }
    // Degistirme karakteri = gecersiz bayt dizisi (bozuk kodlama).
    expect(metin).not.toContain('�');
    // GIDIS-DONUS: dosya gercekten UTF-8. 'BÂNÎ' gibi mesru diziler yuzunden
    // desen aramak yaniltir (Â harfi metinde DOGRU olarak var); baytlarin
    // kendisi karsilastiriliyor.
    expect(Buffer.from(metin, 'utf8').equals(readFileSync(METIN_YOLU))).toBe(true);
  });

  it('KILITLI ORANLARI tasir (owner karari: 10 / 12 / 8)', () => {
    expect(metin).toContain('BaniMarket: %10 + KDV');
    expect(metin).toContain('BaniYemek: %12 + KDV');
    expect(metin).toContain('Kervan: %8 + KDV');
  });

  it('ANA SOZLESMENIN EKI oldugunu soyler (duplicate ana metin DEGIL)', () => {
    expect(metin).toContain('EK-4 — KOMİSYON VE HİZMET BEDELİ TARİFESİ');
    expect(metin).toContain('ayrılmaz eki niteliğindedir');
    // Ana sozlesmenin govdesi buraya KOPYALANMADI: taraflar/tanimlar yok.
    expect(metin).not.toContain('1. TARAFLAR');
  });
});

describe('EK-4 metin <-> migration hash bagi', () => {
  it('migration, metnin GERCEK ozetini yaziyor', () => {
    const beklenen = ozet(metin);
    expect(migration).toContain(beklenen);
  });

  it('migration dogru tip ve surumu yaziyor', () => {
    expect(migration).toContain("'SATICI_KOMISYON'");
    expect(migration).toContain(`'${SURUM}'`);
  });

  it('migration IDEMPOTENT (ON CONFLICT DO NOTHING) ve yalniz INSERT iceriyor', () => {
    expect(migration).toMatch(/ON CONFLICT \("tip", "surum"\) DO NOTHING/);
    // Baska satira dokunan bir ifade OLMAMALI.
    expect(migration).not.toMatch(/^\s*(UPDATE|DELETE|ALTER|DROP)\b/im);
  });

  it('hash kanoniklestirmeye BAGIMLI degil (CRLF ile ayni sonucu verir)', () => {
    const crlf = kanonikMetin(metin).replace(/\n/g, '\r\n');
    expect(ozet(crlf)).toBe(ozet(metin));
  });
});
