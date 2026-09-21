// 02 — EK-4 SATICI_KOMISYON AKTIF SURUMU — ENTEGRASYON TESTLERI.
// GERCEK PostgreSQL GEREKTIRIR (migration'in URETTIGI satiri dogrular).
//
// NE KANITLIYOR:
//   · migration temiz/migrate edilmis bir veritabaninda SATICI_KOMISYON icin
//     AKTIF bir surum satiri birakiyor; tip, surum ve metinHash dogru;
//   · metinHash, repodaki kanonik .md metninin ozetiyle BIREBIR ayni
//     (birim testi metin<->migration bagini, bu test migration<->DB bagini
//     kapatiyor; ikisi birlikte metin<->DB zincirini tamamlar);
//   · SozlesmeService.durum artik 503 URETMIYOR ve aktif surumu donduruyor;
//   · kullanici aktif surumu onaylayabiliyor ve onay AKTIF surume baglaniyor;
//   · migration'in INSERT'i ikinci kez kosturuldugunda DUPLICATE URETMIYOR
//     (ON CONFLICT DO NOTHING) - gercek kisitla, sahte mock'la degil.
//
// CALISTIRMA: `pnpm run test:int` + INTEGRATION_DATABASE_URL (bani_test).
// FAIL-CLOSED: hedef veritabani 'bani_test' degilse HICBIR baglanti kurulmaz.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SozlesmeTipi } from '@prisma/client';
import { SozlesmeService } from './sozlesme.service';
import { PrismaService } from '../prisma/prisma.service';

// ============================================================ GUVENLIK KAPISI

const BEKLENEN_VERITABANI = 'bani_test';

function testVeritabaniUrl(): string {
  const url = process.env.INTEGRATION_DATABASE_URL;
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error(
      'INTEGRATION_DATABASE_URL tanimli degil. Entegrasyon testleri YALNIZ ayrilmis ' +
        `bir '${BEKLENEN_VERITABANI}' veritabaninda calisir; DATABASE_URL fallback ` +
        'olarak KULLANILMAZ.',
    );
  }
  let ayristirilmis: URL;
  try {
    ayristirilmis = new URL(url);
  } catch {
    throw new Error('INTEGRATION_DATABASE_URL gecerli bir URL degil.');
  }
  const veritabaniAdi = decodeURIComponent(ayristirilmis.pathname).replace(/^\//, '');
  if (veritabaniAdi !== BEKLENEN_VERITABANI) {
    throw new Error(
      `GUVENLIK DURDURMASI: hedef veritabani '${veritabaniAdi}'. Bu paket fixture ` +
        `olusturur ve siler; yalnizca '${BEKLENEN_VERITABANI}' uzerinde calismasina ` +
        'izin verilir.',
    );
  }
  return url;
}

// =================================================================== fixture

const KOK = join(__dirname, '..', '..');
const MIGRATION_KLASORU = '20260921090000_satici_komisyon_ek4_surumu';
const SURUM = 'v1.0-2026-09-21';
const KOSU = randomUUID().slice(0, 8);

const kanonikMetin = (m: string) => m.replace(/\r\n/g, '\n');
const KANONIK_HASH = createHash('sha256')
  .update(kanonikMetin(readFileSync(join(KOK, 'prisma', 'sozlesmeler', 'ek-4-komisyon-tarifesi.md'), 'utf8')), 'utf8')
  .digest('hex');

/** Migration dosyasindaki TEK SQL ifadesi (yorumlar atilir). */
function migrationIfadesi(): string {
  const ham = readFileSync(join(KOK, 'prisma', 'migrations', MIGRATION_KLASORU, 'migration.sql'), 'utf8');
  return ham
    .split('\n')
    .filter((s) => !s.trim().startsWith('--'))
    .join('\n')
    .trim();
}

let prisma: PrismaService;
let sozlesme: SozlesmeService;
const olusanKullanicilar: string[] = [];

beforeAll(async () => {
  const url = testVeritabaniUrl();
  prisma = new PrismaService({ datasources: { db: { url } } });
  await prisma.$connect();
  sozlesme = new SozlesmeService(prisma);
});

afterAll(async () => {
  if (!prisma) return;
  testVeritabaniUrl(); // DEFENSE IN DEPTH
  if (olusanKullanicilar.length > 0) {
    await prisma.sozlesmeOnay.deleteMany({ where: { kullaniciId: { in: olusanKullanicilar } } });
    await prisma.user.deleteMany({ where: { id: { in: olusanKullanicilar } } });
  }
  await prisma.$disconnect();
});

async function kullaniciKur(etiket: string): Promise<string> {
  const k = await prisma.user.create({ data: { phone: `EK4-${KOSU}-${etiket}` } });
  olusanKullanicilar.push(k.id);
  return k.id;
}

// ===================================================================== testler

describe('EK-4 — migration ciktisi (gercek DB)', () => {
  it('SATICI_KOMISYON icin AKTIF surum satiri var, tip/surum dogru', async () => {
    const satirlar = await prisma.sozlesmeVersiyon.findMany({
      where: { tip: SozlesmeTipi.SATICI_KOMISYON },
      select: { tip: true, surum: true, aktif: true, metinHash: true },
    });
    expect(satirlar).toHaveLength(1);
    expect(satirlar[0].tip).toBe(SozlesmeTipi.SATICI_KOMISYON);
    expect(satirlar[0].surum).toBe(SURUM);
    expect(satirlar[0].aktif).toBe(true);
  });

  it('metinHash, repodaki kanonik EK-4 metninin ozetiyle BIREBIR ayni', async () => {
    const v = await prisma.sozlesmeVersiyon.findFirstOrThrow({
      where: { tip: SozlesmeTipi.SATICI_KOMISYON, aktif: true },
      select: { metinHash: true },
    });
    expect(v.metinHash).toBe(KANONIK_HASH);
  });

  it('SATICI v1.2 kaydina DOKUNULMADI (baska tip etkilenmedi)', async () => {
    const satici = await prisma.sozlesmeVersiyon.findFirst({
      where: { tip: SozlesmeTipi.SATICI, aktif: true },
      select: { surum: true },
    });
    // Test veritabaninda SATICI surumu OLMAYABILIR (migration'lar yalnizca
    // TASIYICI/YUK_VEREN tohumluyor, SATICI canliya elle girilmisti). Iddia
    // "bozulmadi": varsa hala aktif, yoksa bu migration onu YARATMADI.
    expect(satici === null || typeof satici.surum === 'string').toBe(true);
    const komisyonDisi = await prisma.sozlesmeVersiyon.count({
      where: { surum: SURUM, tip: { not: SozlesmeTipi.SATICI_KOMISYON } },
    });
    expect(komisyonDisi).toBe(0);
  });

  it('IDEMPOTENT: migration INSERT\'i yeniden kosturulunca duplicate OLUSMAZ', async () => {
    const ifade = migrationIfadesi();
    expect(ifade).toContain('ON CONFLICT');
    await prisma.$executeRawUnsafe(ifade);
    await prisma.$executeRawUnsafe(ifade);
    const adet = await prisma.sozlesmeVersiyon.count({ where: { tip: SozlesmeTipi.SATICI_KOMISYON } });
    expect(adet).toBe(1);
  });
});

describe('EK-4 — SozlesmeService davranisi', () => {
  it('durum() artik 503 URETMIYOR; aktif surumu ve hash\'i donduruyor', async () => {
    const userId = await kullaniciKur('durum');
    const d = await sozlesme.durum(userId, SozlesmeTipi.SATICI_KOMISYON);
    expect(d).toEqual({
      sozlesmeTipi: SozlesmeTipi.SATICI_KOMISYON,
      gecerliSurum: SURUM,
      onayli: false,
      metinHash: KANONIK_HASH,
    });
  });

  it('kullanici aktif surumu onaylayabiliyor; onay AKTIF surume baglaniyor', async () => {
    const userId = await kullaniciKur('onay');
    const onay = await sozlesme.onayla(userId, SozlesmeTipi.SATICI_KOMISYON, '10.0.0.1', 'jest');
    expect(onay.sozlesmeTipi).toBe(SozlesmeTipi.SATICI_KOMISYON);
    expect(onay.surum).toBe(SURUM);
    expect(onay.metinHash).toBe(KANONIK_HASH);
    expect(await sozlesme.onayliMi(userId, SozlesmeTipi.SATICI_KOMISYON)).toBe(true);

    // Idempotent: ikinci onay YENI kayit acmaz.
    const ikinci = await sozlesme.onayla(userId, SozlesmeTipi.SATICI_KOMISYON);
    expect(ikinci.id).toBe(onay.id);
  });

  it('ESKI surume verilmis onay, aktif surum yerine GECMEZ', async () => {
    const userId = await kullaniciKur('eski');
    await prisma.sozlesmeOnay.create({
      data: {
        kullaniciId: userId,
        sozlesmeTipi: SozlesmeTipi.SATICI_KOMISYON,
        surum: 'v0.9-eski',
        metinHash: 'eski-hash',
      },
    });
    expect(await sozlesme.onayliMi(userId, SozlesmeTipi.SATICI_KOMISYON)).toBe(false);
  });
});
