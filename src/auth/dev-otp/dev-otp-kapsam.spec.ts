// PRODUCTION devCode KAPSAMI — bayrak + kayit defteri matrisi.
//
// Kabul kriteri (gate): production'da ALLOW_DEV_CODE=true olsa BILE kayit
// defterinde olmayan bir numaraya devCode DONMEZ. Asagidaki 2 numarali test
// tam olarak bunu kilitliyor.
//
// @nestjs/testing KULLANILMIYOR (D132 emsali): bagimliliklar konumsal
// constructor parametreleri oldugu icin dogrudan `new` yeterli.
import { AuthService } from '../auth.service';
import { TestTelefonKayit } from './test-telefon-kayit.service';
import {
  TEST_TELEFON_ANAHTAR_ONEKI,
  TEST_TELEFON_TTL_SANIYE,
  testTelefonAnahtari,
} from './test-telefon-anahtar';

const TELEFON = '+905551119999';
const KOD = '482913';

function otpSahte() {
  return { issue: jest.fn().mockResolvedValue(KOD), verify: jest.fn() } as any;
}

function authKur(kayitliMi: jest.Mock) {
  const otp = otpSahte();
  const kayit = { kayitliMi } as unknown as TestTelefonKayit;
  const auth = new AuthService({} as any, otp, {} as any, kayit);
  return { auth, otp, kayitliMi };
}

const ORIJINAL = { ...process.env };
afterEach(() => {
  process.env = { ...ORIJINAL };
  jest.restoreAllMocks();
});

describe('production devCode kapsami', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  it('1. bayrak false + kayit VAR -> devCode YOK (kayit tek basina yetmez)', async () => {
    process.env.ALLOW_DEV_CODE = 'false';
    const { auth, kayitliMi } = authKur(jest.fn().mockResolvedValue(true));
    const y = await auth.requestOtp(TELEFON);
    expect(y).toEqual({ sent: true, devCode: undefined });
    // Bayrak kapaliyken kayit defterine hic gidilmez.
    expect(kayitliMi).not.toHaveBeenCalled();
  });

  it('2. bayrak true + kayit YOK -> devCode YOK (ANA KABUL KRITERI)', async () => {
    process.env.ALLOW_DEV_CODE = 'true';
    const { auth, kayitliMi } = authKur(jest.fn().mockResolvedValue(false));
    const y = await auth.requestOtp(TELEFON);
    expect(y.devCode).toBeUndefined();
    expect(y.sent).toBe(true);
    expect(kayitliMi).toHaveBeenCalledWith(TELEFON);
  });

  it('3. bayrak true + kayit VAR -> devCode VAR', async () => {
    process.env.ALLOW_DEV_CODE = 'true';
    const { auth } = authKur(jest.fn().mockResolvedValue(true));
    const y = await auth.requestOtp(TELEFON);
    expect(y).toEqual({ sent: true, devCode: KOD });
  });

  it('4. bayrak true + Redis hatasi -> devCode YOK ama OTP istegi normal biter', async () => {
    process.env.ALLOW_DEV_CODE = 'true';
    // Gercek servis: cache.get firlatiyor, kayitliMi false'a dusuyor (kapali basarisiz).
    const patlayanCache = { get: jest.fn().mockRejectedValue(new Error('redis down')) } as any;
    const kayit = new TestTelefonKayit(patlayanCache);
    const otp = otpSahte();
    const auth = new AuthService({} as any, otp, {} as any, kayit);

    const y = await auth.requestOtp(TELEFON);

    expect(y).toEqual({ sent: true, devCode: undefined });
    expect(otp.issue).toHaveBeenCalledWith(TELEFON); // kod yine uretildi
  });

  it('5. bayrak true + kayit VAR: her istekte YENIDEN sorulur (kod tek seferlik yetki degil)', async () => {
    process.env.ALLOW_DEV_CODE = 'true';
    const kayitliMi = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { auth } = authKur(kayitliMi);
    expect((await auth.requestOtp(TELEFON)).devCode).toBe(KOD);
    expect((await auth.requestOtp(TELEFON)).devCode).toBeUndefined();
  });
});

describe('production disi davranis KORUNDU', () => {
  it.each(['development', 'test', undefined])('NODE_ENV=%p -> devCode doner, kayit defteri SORULMAZ', async (ortam) => {
    if (ortam === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ortam;
    delete process.env.ALLOW_DEV_CODE;
    const { auth, kayitliMi } = authKur(jest.fn().mockResolvedValue(false));
    const y = await auth.requestOtp(TELEFON);
    expect(y).toEqual({ sent: true, devCode: KOD });
    expect(kayitliMi).not.toHaveBeenCalled();
  });
});

describe('TestTelefonKayit', () => {
  function cacheSahte() {
    return { set: jest.fn().mockResolvedValue(undefined), get: jest.fn(), del: jest.fn().mockResolvedValue(undefined) };
  }

  it('6. kaydet: dogru anahtar + TTL (cache-manager MILISANIYE bekliyor)', async () => {
    const cache = cacheSahte();
    await new TestTelefonKayit(cache as any).kaydet(TELEFON);
    expect(cache.set).toHaveBeenCalledWith(testTelefonAnahtari(TELEFON), 1, TEST_TELEFON_TTL_SANIYE * 1000);
    expect(TEST_TELEFON_TTL_SANIYE).toBe(3600);
  });

  it('6b. kaydet: ozel TTL saniye olarak verilir', async () => {
    const cache = cacheSahte();
    await new TestTelefonKayit(cache as any).kaydet(TELEFON, 120);
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), 1, 120_000);
  });

  it('7. sil: anahtar dusurulur ve sonrasinda kayitliMi false', async () => {
    const cache = cacheSahte();
    const kayit = new TestTelefonKayit(cache as any);
    await kayit.sil(TELEFON);
    expect(cache.del).toHaveBeenCalledWith(testTelefonAnahtari(TELEFON));
    cache.get.mockResolvedValue(undefined);
    expect(await kayit.kayitliMi(TELEFON)).toBe(false);
  });

  it('kayitliMi: deger varsa true, undefined/null ise false', async () => {
    const cache = cacheSahte();
    const kayit = new TestTelefonKayit(cache as any);
    cache.get.mockResolvedValue(1);
    expect(await kayit.kayitliMi(TELEFON)).toBe(true);
    cache.get.mockResolvedValue(null);
    expect(await kayit.kayitliMi(TELEFON)).toBe(false);
  });

  it('anahtar: telefon ACIK gecmez, onek + sha256', () => {
    const anahtar = testTelefonAnahtari(TELEFON);
    expect(anahtar.startsWith(TEST_TELEFON_ANAHTAR_ONEKI)).toBe(true);
    expect(anahtar).not.toContain('5551119999');
    expect(anahtar).toMatch(/^dev-otp:test-phone:[a-f0-9]{64}$/);
    expect(testTelefonAnahtari(' ' + TELEFON + ' ')).toBe(anahtar); // bosluk toleransi
    expect(testTelefonAnahtari('+905551110000')).not.toBe(anahtar);
  });
});
