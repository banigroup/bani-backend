// OWNER KABUL TESTI SABIT OTP'SI — ENTEGRASYON TESTLERI.
// GERCEK PostgreSQL GEREKTIRIR (otp_requests tablosu uzerinde gercek akis).
//
// NE KANITLIYOR (birim testinin sahte Prisma'siyla degil, gercek satirla):
//   · owner numarasi + sabit kod -> PASS; satir consumedAt ile tuketilir, SMS YOK;
//   · owner numarasi + yanlis kod -> FAIL; attempts gercek satirda artar;
//   · baska numara + sabit kod -> FAIL;
//   · baska numara + gercek (SMS'e giden) kod -> PASS (normal akis);
//   · config yok -> owner numarasi da normal akista (SMS + rastgele kod).
//
// CALISTIRMA: `pnpm run test:int` + INTEGRATION_DATABASE_URL (bani_test).
// FAIL-CLOSED: hedef veritabani 'bani_test' degilse HICBIR baglanti kurulmaz.
import { BadRequestException } from '@nestjs/common';
import { OtpService } from './otp.service';
import { PrismaService } from '../../prisma/prisma.service';

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

const OWNER = '+905551112233';
const OWNER_KOD = '112233';
// Her kosuda farkli "baska" numaralar: onceki kosunun satirlari cooldown'a takilmasin.
const rastgeleTelefon = () => `+9055${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const kullanilan: string[] = [OWNER];

let prisma: PrismaService;

function servis(ayar: Record<string, unknown>) {
  const config = { get: (k: string, v?: unknown) => (k in ayar ? ayar[k] : v) };
  const sms = { send: jest.fn(async () => undefined) };
  return { otp: new OtpService(prisma, config as any, sms as any), sms };
}
const OWNER_AYARI = { 'otp.ownerTestPhone': OWNER, 'otp.ownerTestCode': OWNER_KOD };

async function temizle() {
  await prisma.otpRequest.deleteMany({ where: { phone: { in: kullanilan } } });
}

beforeAll(async () => {
  prisma = new PrismaService({ datasources: { db: { url: testVeritabaniUrl() } } });
  await prisma.$connect();
});

beforeEach(async () => {
  testVeritabaniUrl(); // DEFENSE IN DEPTH
  await temizle();
});

afterAll(async () => {
  if (!prisma) return;
  testVeritabaniUrl();
  await temizle();
  await prisma.$disconnect();
});

// ===================================================================== testler

describe('Owner kabul testi OTP — gercek DB', () => {
  it('owner numarasi + sabit kod -> PASS, satir tuketilir, SMS YOK', async () => {
    const { otp, sms } = servis(OWNER_AYARI);
    await otp.issue(OWNER);
    expect(sms.send).not.toHaveBeenCalled();
    await expect(otp.verify(OWNER, OWNER_KOD)).resolves.toBe(true);
    const satir = await prisma.otpRequest.findFirstOrThrow({ where: { phone: OWNER }, orderBy: { createdAt: 'desc' } });
    expect(satir.consumedAt).not.toBeNull();
  });

  it('owner numarasi + yanlis kod -> FAIL, attempts gercek satirda artar', async () => {
    const { otp } = servis(OWNER_AYARI);
    await otp.issue(OWNER);
    await expect(otp.verify(OWNER, '000000')).rejects.toBeInstanceOf(BadRequestException);
    const satir = await prisma.otpRequest.findFirstOrThrow({ where: { phone: OWNER }, orderBy: { createdAt: 'desc' } });
    expect(satir.attempts).toBe(1);
    expect(satir.consumedAt).toBeNull();
  });

  it('baska numara + sabit kod -> FAIL', async () => {
    const baska = rastgeleTelefon();
    kullanilan.push(baska);
    const { otp, sms } = servis(OWNER_AYARI);
    const gercek = await otp.issue(baska);
    expect(sms.send).toHaveBeenCalledTimes(1);
    // 1/10^6 ihtimalle rastgele kod sabit koda denk gelirse test anlamsizlasir: acikca reddet.
    expect(gercek).not.toBe(OWNER_KOD);
    await expect(otp.verify(baska, OWNER_KOD)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('baska numara + gercek kod -> PASS (normal akis)', async () => {
    const baska = rastgeleTelefon();
    kullanilan.push(baska);
    const { otp, sms } = servis(OWNER_AYARI);
    const gercek = await otp.issue(baska);
    expect(sms.send).toHaveBeenCalledWith(baska, `Bani Group doğrulama kodunuz: ${gercek}`);
    await expect(otp.verify(baska, gercek)).resolves.toBe(true);
  });

  it('config yok -> owner numarasi normal akista: SMS gider, sabit kod FAIL, gercek kod PASS', async () => {
    const { otp, sms } = servis({});
    const gercek = await otp.issue(OWNER);
    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(gercek).not.toBe(OWNER_KOD);
    await expect(otp.verify(OWNER, OWNER_KOD)).rejects.toBeInstanceOf(BadRequestException);
    await expect(otp.verify(OWNER, gercek)).resolves.toBe(true);
  });
});
