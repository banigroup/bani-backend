// 02 / KYC — BELGE ADRESININ YANITA IMZALI CIKMASI (servis kablolamasi).
//
// kyc-dosya.spec.ts imzalama fonksiyonunun KENDISINI kanitliyor; bu paket o
// fonksiyonun BELGE DONDUREN HER UCTA gercekten devrede oldugunu kanitlar.
// Bir uc atlanirsa ham 'authenticated' adres disari cikar - kirilma sessiz
// olurdu, cunku adres yine "calisiyor gibi" gorunur (401'i ancak tiklayinca
// alirsiniz).
import { Role, SaticiBelgeDurum, SaticiBelgeTipi } from '@prisma/client';
import { MarketService } from './market.service';
import { SellerStatusService } from './seller-status.service';
import { AuditService } from '../common/audit/audit.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { PrismaService } from '../prisma/prisma.service';

const KULLANICI = '11111111-1111-1111-1111-111111111111';
const SATICI_ID = '22222222-2222-2222-2222-222222222222';
const HAM_URL =
  'https://res.cloudinary.com/demo/image/authenticated/v1700000000/banimarket/satici/abc/levha.pdf';

function belgeSatiri(ustuneYaz: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    sellerId: SATICI_ID,
    tip: SaticiBelgeTipi.VERGI_LEVHASI,
    dosyaUrl: HAM_URL,
    durum: SaticiBelgeDurum.BEKLIYOR,
    redGerekce: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...ustuneYaz,
  };
}

function kur() {
  const satici = {
    id: SATICI_ID,
    ownerUserId: KULLANICI,
    legalName: 'Ornek',
    displayName: 'Ornek',
    deletedAt: null,
    owner: { id: KULLANICI, phone: '+900000000000', name: 'A', surname: 'B', status: 'ACTIVE' },
    belgeler: [belgeSatiri()],
    stores: [],
  };
  const prisma = {
    seller: {
      findFirst: jest.fn(async () => ({ ...satici })),
      update: jest.fn(async () => ({ id: SATICI_ID, verification: 'BEKLIYOR', verificationExpiresAt: null })),
    },
    saticiBelge: {
      create: jest.fn(async (_args: Record<string, any>) => belgeSatiri()),
      findMany: jest.fn(async () => [belgeSatiri()]),
      findFirst: jest.fn(async () => belgeSatiri()),
      update: jest.fn(async () => belgeSatiri({ durum: SaticiBelgeDurum.ONAYLANDI })),
      count: jest.fn(async () => 1),
    },
    sozlesmeOnay: { findMany: jest.fn(async () => []) },
    // bekleyenBelgeler count+findMany'yi DIZI olarak veriyor; saticiDetay ise
    // transaction kullanmiyor. Dizi halini beklemek yeterli.
    $transaction: jest.fn(async (islemler: Promise<unknown>[]): Promise<unknown[]> => Promise.all(islemler)),
  };
  const market = new MarketService(
    prisma as unknown as PrismaService,
    { record: jest.fn(), recordWithTx: jest.fn() } as unknown as AuditService,
    new SellerStatusService(),
    {} as unknown as SozlesmeService,
  );
  return { market, prisma };
}

/** Imzali adresin ayirt edici izi: ham adres DEGIL ve imza tasiyor. */
function imzaliMi(url: string): boolean {
  return url !== HAM_URL && url.includes('signature=');
}

describe('02 / KYC — ham Cloudinary adresi hicbir uctan sizmaz', () => {
  const eski = { ...process.env };
  beforeAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo';
    process.env.CLOUDINARY_API_KEY = '000000000000000';
    process.env.CLOUDINARY_API_SECRET = 'test-secret-ASLA-GERCEK-DEGIL';
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

  it('15. satici kendi belgelerini imzali adresle alir (GET seller/belgeler)', async () => {
    const { market } = kur();
    const belgeler = await market.belgelerim(KULLANICI);
    expect(belgeler).toHaveLength(1);
    expect(imzaliMi(belgeler[0].dosyaUrl)).toBe(true);
  });

  it('15. admin satici detayinda belgeler imzali gelir (GET sellers/:id)', async () => {
    const { market } = kur();
    const detay = await market.saticiDetay([Role.ADMIN], SATICI_ID);
    expect(imzaliMi(detay.belgeler[0].dosyaUrl)).toBe(true);
  });

  it('15. admin bekleyen belge kuyrugu imzali gelir', async () => {
    const { market } = kur();
    const kuyruk = await market.bekleyenBelgeler([Role.ADMIN]);
    expect(imzaliMi(kuyruk.kayitlar[0].dosyaUrl)).toBe(true);
  });

  it('yukleme yaniti da imzali doner (ham adres istemciye hic gitmez)', async () => {
    const { market } = kur();
    const belge = await market.belgeEkle(KULLANICI, SaticiBelgeTipi.VERGI_LEVHASI, HAM_URL);
    expect(imzaliMi(belge.dosyaUrl)).toBe(true);
  });

  it('belge karari yaniti da imzali doner', async () => {
    const { market } = kur();
    const sonuc = await market.belgeOnayla([Role.ADMIN], 'belge-id');
    expect(imzaliMi(sonuc.belge.dosyaUrl)).toBe(true);
  });

  it('14. DB\'de duran adres DEGISMEZ (yalniz yanit imzalanir)', async () => {
    const { market, prisma } = kur();
    await market.belgeEkle(KULLANICI, SaticiBelgeTipi.VERGI_LEVHASI, HAM_URL);
    const yazilan = prisma.saticiBelge.create.mock.calls[0][0] as unknown as {
      data: { dosyaUrl: string };
    };
    expect(yazilan.data.dosyaUrl).toBe(HAM_URL);
  });
});
