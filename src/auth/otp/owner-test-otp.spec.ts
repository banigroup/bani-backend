// OWNER KABUL TESTI SABIT OTP'SI — BIRIM TESTLERI.
//
// KANITLANAN SOZLESME (owner karari, LOCKED):
//   owner numarasi + sabit kod        -> PASS, SMS YOK
//   owner numarasi + yanlis kod       -> FAIL, deneme sayaci artar, 5'te kilit
//   baska numara + sabit kod          -> FAIL (baska numara rastgele kod alir)
//   baska numara + gercek kod         -> PASS, SMS gider (normal akis)
//   config eksik/bozuk                -> owner numarasi da NORMAL akista
//   yalnizca TAM eslesme; log'da kod ve numara YOK
//
// SAHTE PRISMA = BELLEK ICI otp_requests. randomInt sabitlenir ki "baska numara
// + sabit kod" testi 1/10^6 sansla bile yesile donmesin.
jest.mock('crypto', () => ({ ...jest.requireActual('crypto'), randomInt: jest.fn(() => 654321) }));

import { BadRequestException, Logger } from '@nestjs/common';
import { OtpService } from './otp.service';
import { ownerTestKodu } from './owner-test-otp';
import { AuthController } from '../auth.controller';

const OWNER = '+905551112233';
const OWNER_KOD = '112233';
const BASKA = '+905559998877';
const RASTGELE = '654321';

type Satir = { id: string; phone: string; codeHash: string; expiresAt: Date; consumedAt: Date | null; attempts: number; createdAt: Date };

function ortamKur(ayar: Record<string, unknown> = { 'otp.ownerTestPhone': OWNER, 'otp.ownerTestCode': OWNER_KOD }) {
  const satirlar: Satir[] = [];
  let sira = 0;
  const prisma = {
    otpRequest: {
      findFirst: jest.fn(async ({ where }: any) => {
        const adaylar = satirlar
          .filter((s) => s.phone === where.phone)
          .filter((s) => (where.createdAt ? s.createdAt > where.createdAt.gt : true))
          .filter((s) => (where.consumedAt === null ? s.consumedAt === null : true))
          .filter((s) => (where.expiresAt ? s.expiresAt > where.expiresAt.gt : true));
        return adaylar.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const s: Satir = { id: `otp-${++sira}`, consumedAt: null, attempts: 0, createdAt: new Date(), ...data };
        satirlar.push(s);
        return s;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const s = satirlar.find((x) => x.id === where.id)!;
        if (data.attempts?.increment) s.attempts += data.attempts.increment;
        if (data.consumedAt) s.consumedAt = data.consumedAt;
        return s;
      }),
    },
  };
  const config = { get: jest.fn((k: string, v?: unknown) => (k in ayar ? ayar[k] : v)) };
  const sms = { send: jest.fn(async () => undefined) };
  const otp = new OtpService(prisma as any, config as any, sms as any);
  return { otp, sms, satirlar };
}

describe('ownerTestKodu (karar fonksiyonu)', () => {
  const ayar = { phone: OWNER, code: OWNER_KOD };

  it('yalnizca TAM numara sabit kodu alir', () => {
    expect(ownerTestKodu(OWNER, ayar, 6)).toBe(OWNER_KOD);
  });

  it.each([
    ['baska numara', BASKA],
    ['sonek fazlasi', `${OWNER}0`],
    ['onek eksigi', OWNER.slice(0, -1)],
    ['+ olmadan', OWNER.slice(1)],
    ['bosluklu', ` ${OWNER}`],
    ['ulusal bicim', '05551112233'],
  ])('%s -> null', (_, telefon) => {
    expect(ownerTestKodu(telefon, ayar, 6)).toBeNull();
  });

  it.each([
    ['telefon yok', { code: OWNER_KOD }],
    ['kod yok', { phone: OWNER }],
    ['ikisi de yok', {}],
    ['bos telefon', { phone: '', code: OWNER_KOD }],
    ['bos kod', { phone: OWNER, code: '' }],
    ['E.164 olmayan telefon', { phone: '05551112233', code: OWNER_KOD }],
    ['kisa kod', { phone: OWNER, code: '1122' }],
    ['uzun kod', { phone: OWNER, code: '1122334' }],
    ['rakam olmayan kod', { phone: OWNER, code: '11a233' }],
  ])('config %s -> KAPALI (null)', (_, bozuk) => {
    expect(ownerTestKodu(OWNER, bozuk as any, 6)).toBeNull();
  });
});

describe('OtpService — owner kabul testi', () => {
  it('owner numarasi + sabit kod -> PASS, SMS GONDERILMEZ', async () => {
    const { otp, sms } = ortamKur();
    await otp.issue(OWNER);
    expect(sms.send).not.toHaveBeenCalled();
    await expect(otp.verify(OWNER, OWNER_KOD)).resolves.toBe(true);
  });

  it('owner numarasi + yanlis kod -> FAIL, deneme sayaci artar', async () => {
    const { otp, satirlar } = ortamKur();
    await otp.issue(OWNER);
    await expect(otp.verify(OWNER, '000000')).rejects.toBeInstanceOf(BadRequestException);
    expect(satirlar[0].attempts).toBe(1);
    expect(satirlar[0].consumedAt).toBeNull();
  });

  it('owner numarasi: 5 hatali denemeden sonra DOGRU kod da reddedilir (kilit korunuyor)', async () => {
    const { otp } = ortamKur();
    await otp.issue(OWNER);
    for (let i = 0; i < 5; i++) await expect(otp.verify(OWNER, '000000')).rejects.toBeInstanceOf(BadRequestException);
    await expect(otp.verify(OWNER, OWNER_KOD)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('owner kodu TEK KULLANIMLIK: ikinci verify yeni istek olmadan FAIL', async () => {
    const { otp } = ortamKur();
    await otp.issue(OWNER);
    await otp.verify(OWNER, OWNER_KOD);
    await expect(otp.verify(OWNER, OWNER_KOD)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('owner numarasi: istek yapilmadan sabit kod GECMEZ', async () => {
    const { otp } = ortamKur();
    await expect(otp.verify(OWNER, OWNER_KOD)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('owner numarasi: cooldown korunuyor (60 sn icinde ikinci istek red)', async () => {
    const { otp } = ortamKur();
    await otp.issue(OWNER);
    await expect(otp.issue(OWNER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('baska numara + sabit kod -> FAIL', async () => {
    const { otp, sms } = ortamKur();
    await otp.issue(BASKA);
    expect(sms.send).toHaveBeenCalledTimes(1);
    await expect(otp.verify(BASKA, OWNER_KOD)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('baska numara + gercek kod -> PASS, SMS kodla gider (normal akis degismedi)', async () => {
    const { otp, sms } = ortamKur();
    const kod = await otp.issue(BASKA);
    expect(kod).toBe(RASTGELE);
    expect(sms.send).toHaveBeenCalledWith(BASKA, `Bani Group doğrulama kodunuz: ${RASTGELE}`);
    await expect(otp.verify(BASKA, RASTGELE)).resolves.toBe(true);
  });

  it.each([
    ['config hic yok', {}],
    ['yalniz telefon', { 'otp.ownerTestPhone': OWNER }],
    ['yalniz kod', { 'otp.ownerTestCode': OWNER_KOD }],
  ])('%s -> owner numarasi NORMAL akista (SMS + rastgele kod, sabit kod FAIL)', async (_, ayar) => {
    const { otp, sms } = ortamKur(ayar);
    const kod = await otp.issue(OWNER);
    expect(kod).toBe(RASTGELE);
    expect(sms.send).toHaveBeenCalledTimes(1);
    expect(otp.ownerTestMi(OWNER)).toBe(false);
    await expect(otp.verify(OWNER, OWNER_KOD)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('log kaydinda kod ve numara YOK, OWNER_TEST etiketi VAR', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const { otp } = ortamKur();
      await otp.issue(OWNER);
      const yazilanlar = log.mock.calls.map((c) => String(c[0])).join('\n');
      expect(yazilanlar).toContain('OWNER_TEST');
      expect(yazilanlar).not.toContain(OWNER_KOD);
      expect(yazilanlar).not.toContain('5551112233');
    } finally {
      log.mockRestore();
    }
  });
});

describe('AuthController.verifyOtp — OWNER_TEST audit ayrimi', () => {
  function kontrolcu(ownerMi: boolean, hata?: Error) {
    const auth = {
      verifyOtp: jest.fn(async () => {
        if (hata) throw hata;
        return { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', phone: OWNER, roles: [], status: 'ACTIVE' } };
      }),
      ownerTestMi: jest.fn(() => ownerMi),
    };
    const audit = { record: jest.fn(async () => undefined) };
    const req = { ip: '1.2.3.4', headers: {} } as any;
    return { c: new AuthController(auth as any, audit as any), audit, req };
  }

  it('owner girisi -> auth.otp.ownerTest kaydi, metadata\'da kod YOK', async () => {
    const { c, audit, req } = kontrolcu(true);
    await c.verifyOtp({ phone: OWNER, code: OWNER_KOD } as any, req);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const kayit = (audit.record.mock.calls[0] as any[])[0];
    expect(kayit).toMatchObject({ action: 'auth.otp.ownerTest', actorId: 'u1', entity: 'User', entityId: 'u1' });
    expect(JSON.stringify(kayit)).not.toContain(OWNER_KOD);
  });

  it('normal giris -> ek audit YOK (davranis degismedi)', async () => {
    const { c, audit, req } = kontrolcu(false);
    await c.verifyOtp({ phone: BASKA, code: RASTGELE } as any, req);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('owner numarasi + hatali kod -> hata aynen yukari, audit YOK', async () => {
    const { c, audit, req } = kontrolcu(true, new BadRequestException('Kod geçersiz veya süresi dolmuş.'));
    await expect(c.verifyOtp({ phone: OWNER, code: '000000' } as any, req)).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.record).not.toHaveBeenCalled();
  });
});
