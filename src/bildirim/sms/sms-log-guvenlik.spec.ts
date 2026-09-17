// F1 + PII LOG GUVENLIGI — SMS saglayici secimi ve log ciktilari.
//
// SENTINEL YAKLASIMI: ayirt edici OTP/telefon degerleri gonderilir, sonra
// stdout/stderr ve console'a yazilan HER SEYDE aranir. Nest Logger stdout'a
// yazdigi icin akislar dogrudan dinleniyor (Logger mock'lanmiyor - mock'lansaydi
// gercek bicimlendirilmis cikti hic test edilmemis olurdu).
//
// SECIM TESTLERI jest.isolateModules ile: moduller saglayiciyi IMPORT ANINDA
// process.env'den seciyor, her senaryo modulu temiz yuklemeli.
import 'reflect-metadata';
import { telefonMaskele } from '../../common/pii/telefon-maskele';

const OTP_SENTINEL_482913 = '482913';
const PHONE_SENTINEL_905550001122 = '+905550001122';
const PHONE_DIGITS = '905550001122';
const MESAJ = `Bani Group doğrulama kodunuz: ${OTP_SENTINEL_482913}`;

function ciktiYakala() {
  const parcalar: string[] = [];
  const kaydet = (x: unknown) => {
    parcalar.push(typeof x === 'string' ? x : Buffer.isBuffer(x) ? x.toString('utf8') : String(x));
  };
  const casuslar = [
    jest.spyOn(process.stdout, 'write').mockImplementation((x: any) => (kaydet(x), true)),
    jest.spyOn(process.stderr, 'write').mockImplementation((x: any) => (kaydet(x), true)),
    ...(['log', 'warn', 'error', 'info', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation((...a: unknown[]) => a.forEach(kaydet)),
    ),
  ];
  return {
    metin: () => parcalar.join('\n'),
    birak: () => casuslar.forEach((c) => c.mockRestore()),
  };
}

function sentinelYok(metin: string) {
  expect(metin).not.toContain(OTP_SENTINEL_482913);
  expect(metin).not.toContain(PHONE_DIGITS);
}

const ORIJINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIJINAL_ENV };
  jest.restoreAllMocks();
});

function smsSaglayiciAdi(modulYolu: string, modulAdi: string): string {
  let ad = '';
  jest.isolateModules(() => {
    const cikti = ciktiYakala(); // auth.module acilis log satirini sustur
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const modul = require(modulYolu)[modulAdi];
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SMS_PROVIDER } = require('./sms-provider.interface');
      const providers: any[] = Reflect.getMetadata('providers', modul) ?? [];
      ad = providers.find((p) => p && p.provide === SMS_PROVIDER)?.useClass?.name ?? '';
    } finally {
      cikti.birak();
    }
  });
  return ad;
}

describe('F1 — SMS saglayici secimi', () => {
  const moduller: Array<[string, string]> = [
    ['../bildirim.module', 'BildirimModule'],
    ['../../auth/auth.module', 'AuthModule'],
  ];

  it.each(moduller)('1. production + SMS_AKTIF=true -> gercek saglayici (%s)', (yol, ad) => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_AKTIF = 'true';
    expect(smsSaglayiciAdi(yol, ad)).toBe('IletiMerkeziSmsProvider');
  });

  it.each(['false', '', 'TRUE', '1', ' true', undefined])(
    '2. production + SMS_AKTIF=%p -> konsol saglayiciya SESSIZ geri dusus yok (gonderim hata verir, icerik loglanmaz)',
    async (deger) => {
      process.env.NODE_ENV = 'production';
      if (deger === undefined) delete process.env.SMS_AKTIF;
      else process.env.SMS_AKTIF = deger;

      for (const [yol, ad] of moduller) expect(smsSaglayiciAdi(yol, ad)).toBe('ConsoleSmsProvider');

      const { ConsoleSmsProvider } = await import('./console-sms.provider');
      const cikti = ciktiYakala();
      try {
        await expect(new ConsoleSmsProvider().send(PHONE_SENTINEL_905550001122, MESAJ)).rejects.toThrow(
          'SMS saglayicisi yapilandirilmamis',
        );
        const metin = cikti.metin();
        expect(metin).toContain('SMS_AKTIF=true olmali');
        sentinelYok(metin);
      } finally {
        cikti.birak();
      }
    },
  );
});

describe('F1 — ConsoleSmsProvider log icerigi (gelistirme)', () => {
  it.each(['development', 'test', undefined])('3+4. NODE_ENV=%p -> acik OTP ve tam telefon loglanmaz', async (ortam) => {
    if (ortam === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ortam;
    const { ConsoleSmsProvider } = await import('./console-sms.provider');
    const cikti = ciktiYakala();
    try {
      await expect(new ConsoleSmsProvider().send(PHONE_SENTINEL_905550001122, MESAJ)).resolves.toBeUndefined();
      const metin = cikti.metin();
      expect(metin).toContain('[DEV SMS]');
      expect(metin).toContain('+90********22');
      sentinelYok(metin);
    } finally {
      cikti.birak();
    }
  });
});

describe('PII — IletiMerkeziSmsProvider log icerigi', () => {
  // Saglayici yaniti mesaji ve numarayi GERI YANSITIRSA bile loga dusmemeli.
  const yansitan = JSON.stringify({ echo: MESAJ, numara: PHONE_DIGITS });
  // Ucuncu alan: log satiri maskeli telefonu tasimali mi (ag istisnasi satiri
  // numara yazmiyordu, bu pakette de eklenmedi).
  const senaryolar: Array<[string, () => Promise<Response>, boolean]> = [
    ['HTTP hata', async () => new Response(yansitan, { status: 500 }), true],
    ['ayristirilamayan yanit', async () => new Response(`<html>${MESAJ} ${PHONE_DIGITS}</html>`, { status: 200 }), true],
    [
      'reddedildi',
      async () =>
        new Response(
          JSON.stringify({ response: { status: { code: '401', message: `${PHONE_DIGITS} icin gonderilemedi` } } }),
          { status: 200 },
        ),
      true,
    ],
    [
      'basarili',
      async () => new Response(JSON.stringify({ response: { status: { code: '200' }, order: { id: 'ord-1' } } }), { status: 200 }),
      true,
    ],
    ['ag istisnasi', async () => Promise.reject(new TypeError('fetch failed')), false],
  ];

  it.each(senaryolar)('%s -> tam telefon/OTP yok, hata yutma davranisi ayni', async (_ad, yanit, maskeliBekleniyor) => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(yanit as any);
    const { IletiMerkeziSmsProvider } = await import('./iletimerkezi-sms.provider');
    const cikti = ciktiYakala();
    try {
      await expect(new IletiMerkeziSmsProvider().send(PHONE_SENTINEL_905550001122, MESAJ)).resolves.toBeUndefined();
      const metin = cikti.metin();
      expect(metin.length).toBeGreaterThan(0);
      if (maskeliBekleniyor) expect(metin).toContain('90********22');
      sentinelYok(metin);
    } finally {
      cikti.birak();
    }
  });
});

describe('PII — BildirimService hata logu', () => {
  it('gonderim hatasinda tam telefon loglanmaz, kayit yine yazilir', async () => {
    const { BildirimService } = await import('../bildirim.service');
    const create = jest.fn().mockResolvedValue({});
    const prisma = { bildirimKayit: { create } } as any;
    const sms = { send: jest.fn().mockRejectedValue(new Error('SMS saglayicisi yapilandirilmamis')) };
    const cikti = ciktiYakala();
    try {
      await new BildirimService(prisma, sms).gonderSms(PHONE_SENTINEL_905550001122, 'TEKLIF_GELDI', { ilan: 'X1' });
      const metin = cikti.metin();
      expect(metin).toContain('+90********22');
      expect(metin).not.toContain(PHONE_DIGITS);
    } finally {
      cikti.birak();
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.durum).toBe('HATA');
  });
});

describe('telefonMaskele', () => {
  it.each([
    ['+905550001122', '+90********22'],
    ['905550001122', '90********22'],
    ['0555 000 11 22', '05*******22'],
    ['1234', '****'],
    ['', '[bos]'],
    [undefined, '[bos]'],
  ])('%p -> %p', (girdi, beklenen) => {
    expect(telefonMaskele(girdi as any)).toBe(beklenen);
  });
});
