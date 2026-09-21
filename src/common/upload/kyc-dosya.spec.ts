// 02 / KYC — YUKLEME TUR KAPISI VE IMZALI ERISIM — BIRIM TESTLERI.
//
// NE KANITLIYOR:
//   · izin verilmeyen MIME turu ve MIME ile uyusmayan uzanti 400 ile durur;
//   · izin verilen ciftler gecer ve 10 MB siniri BU KAPININ isi DEGIL (boyut
//     multer limitinde, burada turden baska bir sey bakilmaz);
//   · 'authenticated' adres kisa omurlu imzali adrese cevrilir (yetkisiz
//     kisinin eline gecen adres kalici olmaz);
//   · cozulemeyen/eski (public) adres OLDUGU GIBI doner - geriye donuk uyum.
import { BadRequestException } from '@nestjs/common';
import { kycDosyasiniDogrula, uzantiAl, KYC_IZINLI_TURLER } from './kyc-dosya';
import { cloudinaryVarligiCoz, kycImzaliUrl } from './cloudinary.util';

const dosya = (mimetype: string, originalname: string) => ({ mimetype, originalname, size: 1234 });

describe('13 — KYC yukleme tur kapisi', () => {
  it.each([
    ['application/pdf', 'vergi-levhasi.pdf'],
    ['image/jpeg', 'levha.jpg'],
    ['image/jpeg', 'LEVHA.JPEG'],
    ['image/png', 'levha.png'],
    ['image/webp', 'levha.webp'],
    ['image/heic', 'IMG_0001.heic'],
  ])('%s + %s kabul edilir', (mime, ad) => {
    expect(() => kycDosyasiniDogrula(dosya(mime, ad))).not.toThrow();
  });

  it.each([
    ['text/html', 'sayfa.html'],
    ['image/svg+xml', 'cizim.svg'],
    ['application/x-msdownload', 'kurulum.exe'],
    ['application/zip', 'arsiv.zip'],
    ['application/octet-stream', 'belge.pdf'],
  ])('%s REDDEDILIR (izinli listede yok)', (mime, ad) => {
    expect(() => kycDosyasiniDogrula(dosya(mime, ad))).toThrow(BadRequestException);
  });

  it('MIME izinli ama uzanti UYUSMUYOR -> reddedilir', () => {
    expect(() => kycDosyasiniDogrula(dosya('image/jpeg', 'zararli.html'))).toThrow(BadRequestException);
    expect(() => kycDosyasiniDogrula(dosya('application/pdf', 'levha.png'))).toThrow(BadRequestException);
  });

  it('uzantisiz dosya adi reddedilir', () => {
    expect(() => kycDosyasiniDogrula(dosya('application/pdf', 'levha'))).toThrow(BadRequestException);
  });

  it('dosya hic yoksa reddedilir', () => {
    expect(() => kycDosyasiniDogrula(undefined)).toThrow(BadRequestException);
  });

  it('boyut BU KAPIDA denetlenmez (10 MB siniri multer limitinde durur)', () => {
    expect(() =>
      kycDosyasiniDogrula({ mimetype: 'application/pdf', originalname: 'a.pdf', size: 99_000_000 }),
    ).not.toThrow();
  });

  it('uzantiAl: son noktadan sonrasini kucuk harfle verir', () => {
    expect(uzantiAl('a.b.PDF')).toBe('.pdf');
    expect(uzantiAl('uzantisiz')).toBe('');
    expect(uzantiAl('.gizli')).toBe('');
    expect(uzantiAl('bitmis.')).toBe('');
  });

  it('izinli liste yurutulebilir icerik TASIMAZ (html/svg/js yok)', () => {
    const turler = Object.keys(KYC_IZINLI_TURLER);
    expect(turler).not.toContain('text/html');
    expect(turler).not.toContain('image/svg+xml');
    expect(turler).not.toContain('application/javascript');
  });
});

describe('14/15 — KYC belge adresi: imzali ve kisa omurlu', () => {
  const AUTH_URL =
    'https://res.cloudinary.com/demo/image/authenticated/v1700000000/banimarket/satici/abc/def123.pdf';

  it('authenticated adres cozulur (publicId / format / kaynak tipi)', () => {
    expect(cloudinaryVarligiCoz(AUTH_URL)).toEqual({
      publicId: 'banimarket/satici/abc/def123',
      format: 'pdf',
      kaynakTipi: 'image',
    });
  });

  it('surum segmenti olmayan adres de cozulur', () => {
    expect(cloudinaryVarligiCoz('https://res.cloudinary.com/demo/raw/authenticated/klasor/x.pdf')).toEqual({
      publicId: 'klasor/x',
      format: 'pdf',
      kaynakTipi: 'raw',
    });
  });

  it('PUBLIC (/upload/) adres COZULMEZ -> imzalama onu degistirmez (geriye uyum)', () => {
    const publicUrl = 'https://res.cloudinary.com/demo/image/upload/v1/banimarket/satici/abc/eski.png';
    expect(cloudinaryVarligiCoz(publicUrl)).toBeNull();
    expect(kycImzaliUrl(publicUrl)).toBe(publicUrl);
  });

  it('uzantisiz authenticated adres cozulmez (imza format ister)', () => {
    expect(
      cloudinaryVarligiCoz('https://res.cloudinary.com/demo/image/authenticated/v1/klasor/uzantisiz'),
    ).toBeNull();
  });

  describe('imza uretimi (Cloudinary kimlik bilgileriyle)', () => {
    const eski = { ...process.env };
    beforeAll(() => {
      process.env.CLOUDINARY_CLOUD_NAME = 'demo';
      process.env.CLOUDINARY_API_KEY = '000000000000000';
      process.env.CLOUDINARY_API_SECRET = 'test-secret-ASLA-GERCEK-DEGIL';
      // cloudinary.config modul yuklenirken okundu; imza uretimi icin yeniden kur.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('cloudinary').v2.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
    });
    afterAll(() => {
      process.env.CLOUDINARY_CLOUD_NAME = eski.CLOUDINARY_CLOUD_NAME;
      process.env.CLOUDINARY_API_KEY = eski.CLOUDINARY_API_KEY;
      process.env.CLOUDINARY_API_SECRET = eski.CLOUDINARY_API_SECRET;
    });

    it('ham adres DONMEZ; imza ve son kullanma tasiyan yeni adres doner', () => {
      const imzali = kycImzaliUrl(AUTH_URL, 600);
      expect(imzali).not.toBe(AUTH_URL);
      expect(imzali).toContain('signature=');
      expect(imzali).toContain('expires_at=');
    });

    it('son kullanma ISTENEN sure kadar ileride', () => {
      const simdi = Math.floor(Date.now() / 1000);
      const imzali = kycImzaliUrl(AUTH_URL, 600);
      const sure = Number(new URL(imzali).searchParams.get('expires_at'));
      expect(sure).toBeGreaterThanOrEqual(simdi + 595);
      expect(sure).toBeLessThanOrEqual(simdi + 605);
    });
  });
});
