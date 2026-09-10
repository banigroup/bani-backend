// SATICI BASVURUSU ACMA (S2) — BIRIM TESTLERI.
//
// Bu paket SOZLESME davranisini kanitlar: hangi girdi kabul edilir, hangi alan
// nereden gelir, hangi yan etki OLUSMAZ. Gercek DB davranisi (es zamanli iki
// istek, kismi unique index) ayri pakette: satici-olustur.int.spec.ts.
//
// SAHTE PRISMA, MOCK KUTUPHANESI DEGIL: cagrilan yuzey kucuk (seller.findFirst
// + seller.create) ve testin okumak istedigi sey "create'e HANGI data gitti".
// Duz bir nesne bunu ek bir soyutlama katmani olmadan gosteriyor.
import { BadRequestException } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { BusinessUnit, SellerStatus, SellerType, SellerVerification } from '@prisma/client';
import { MarketService } from './market.service';
import { CreateSaticiDto } from './dto/seller.dto';
import { AuditService } from '../common/audit/audit.service';
import { SellerStatusService } from './seller-status.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { PrismaService } from '../prisma/prisma.service';

const KULLANICI = '11111111-1111-1111-1111-111111111111';
const BASKA_KULLANICI = '22222222-2222-2222-2222-222222222222';

// ============================================================================
// TEST ORTAMI HERMETIK: VERGI_KIMLIK_ANAHTARI
// ----------------------------------------------------------------------------
// Bu paket sifreleme yolunu (gizli-alan.sifrele) calistiriyor ve o yol anahtari
// ORTAM DEGISKENINDEN okuyor. Anahtar yoksa uretim kodu BILEREK hata veriyor
// ("sifreli sanilan ama duz duran" kolon en kotu sonuc olurdu) - bu davranis
// DOGRU ve degistirilmiyor.
//
// SORUN: @prisma/client import edilirken yerel .env dosyasini YUKLUYOR (Prisma
// DATABASE_URL'i cozmek icin). Dolayisiyla yerelde anahtar yan etkiyle ortama
// giriyor ve testler yesil kaliyor; CI'da .env OLMADIGI icin ayni testler
// kirmizi oluyordu. Yani test, gizli bir dis dosyaya bagimliydi.
//
// COZUM: anahtari testin KENDISI uretir. `??=` KULLANILMADI bilerek - yerelde
// .env degeri varsa test yine dis ortama bagimli kalirdi. Atama KOSULSUZDUR,
// yani .env ne tasirsa tasisin bu paket kendi anahtarini kullanir.
//
// SABIT TEST ANAHTARI YAZILMADI: deger her kosuda rastgele uretilir ve yalnizca
// surecin belleginde yasar; hicbir dosyaya gizli bir deger girmez.
//
// ONCEKI DEGER GERI YUKLENIR: ayni Jest worker'inda kosan diger paketler
// etkilenmesin (process.env dosya basina degil, SUREC basina paylasilir).
const oncekiVergiKimlikAnahtari = process.env.VERGI_KIMLIK_ANAHTARI;
let testAnahtari = '';

beforeAll(() => {
  testAnahtari = randomBytes(32).toString('hex');
  process.env.VERGI_KIMLIK_ANAHTARI = testAnahtari;
});

afterAll(() => {
  if (oncekiVergiKimlikAnahtari === undefined) {
    delete process.env.VERGI_KIMLIK_ANAHTARI;
  } else {
    process.env.VERGI_KIMLIK_ANAHTARI = oncekiVergiKimlikAnahtari;
  }
  // KANIT (B): geri yukleme gercekten oldu. Hook icinde assert - bozulursa
  // paket kirmizi olur, sessizce sizmaz.
  expect(process.env.VERGI_KIMLIK_ANAHTARI).toBe(oncekiVergiKimlikAnahtari);
});

function gecerliDto(ustuneYaz: Partial<CreateSaticiDto> = {}): CreateSaticiDto {
  return {
    yetkiliAdSoyad: 'Ayse Yilmaz',
    // BOSLUKSUZ, ama BUYUK HARFLI: @IsEmail cevredeki bosluga IZIN VERMEZ
    // (asagida ayrica test ediliyor), dolayisiyla servisteki trim HTTP yolundan
    // tetiklenmez; lowercase ise tetiklenir ve gercekten gereklidir.
    basvuruEposta: 'Basvuru@Ornek.COM',
    legalName: 'Ornek Ticaret Ltd. Sti.',
    displayName: 'Ornek Market',
    sellerType: SellerType.MARKET,
    talepEdilenDikey: BusinessUnit.MARKET,
    ...ustuneYaz,
  } as CreateSaticiDto;
}

/** Cagri kayitlarini tutan sahte prisma. */
function sahtePrisma(mevcutSatici: { id: string } | null) {
  const cagrilar = { create: [] as any[], findFirst: [] as any[] };
  let kayit = mevcutSatici;
  const prisma = {
    seller: {
      findFirst: jest.fn(async (arg: any) => {
        cagrilar.findFirst.push(arg);
        if (!kayit) return null;
        // saticim() zengin select ile cagiriyor; iki cagriyi ayirt etmek icin
        // select'te stores olup olmadigina bakiliyor.
        if (arg?.select?.stores) {
          return {
            id: kayit.id,
            sellerType: SellerType.MARKET,
            legalName: 'MEVCUT UNVAN',
            displayName: 'MEVCUT AD',
            taxLast4: null,
            status: SellerStatus.DRAFT,
            verification: SellerVerification.EKSIK,
            verificationExpiresAt: null,
            createdAt: new Date(),
            stores: [],
          };
        }
        return { id: kayit.id };
      }),
      create: jest.fn(async (arg: any) => {
        cagrilar.create.push(arg);
        kayit = { id: 'yeni-satici-id' };
        return { id: 'yeni-satici-id' };
      }),
    },
  };
  return { prisma, cagrilar };
}

function servisKur(mevcutSatici: { id: string } | null) {
  const { prisma, cagrilar } = sahtePrisma(mevcutSatici);
  const market = new MarketService(
    prisma as unknown as PrismaService,
    {} as unknown as AuditService,
    {} as unknown as SellerStatusService,
    {} as unknown as SozlesmeService,
  );
  return { market, prisma, cagrilar };
}

describe('T1 — CUSTOMER basvuru acar: Seller DRAFT/EKSIK olusur', () => {
  it('create cagrilir ve durum alanlari sema varsayilanina birakilir', async () => {
    const { market, cagrilar } = servisKur(null);

    await market.saticiOlustur(KULLANICI, gecerliDto());

    expect(cagrilar.create).toHaveLength(1);
    const data = cagrilar.create[0].data;
    expect(data.ownerUserId).toBe(KULLANICI);
    expect(data.legalName).toBe('Ornek Ticaret Ltd. Sti.');
    expect(data.talepEdilenDikey).toBe(BusinessUnit.MARKET);
    // status/verification YAZILMIYOR: sema varsayilani (DRAFT / EKSIK) gecerli.
    // Kodda tekrar edilseydi varsayilan degisince iki kaynak ayrisirdi.
    expect(data.status).toBeUndefined();
    expect(data.verification).toBeUndefined();
  });

  it('e-posta lowercase ile normalize edilir', async () => {
    const { market, cagrilar } = servisKur(null);

    await market.saticiOlustur(KULLANICI, gecerliDto());

    expect(cagrilar.create[0].data.basvuruEposta).toBe('basvuru@ornek.com');
  });

  it('e-posta trim edilir (servis seviyesi savunma)', async () => {
    // NOT: bu yol HTTP'den ULASILAMAZ - @IsEmail cevredeki boslugu zaten 400
    // ile reddediyor (asagida T7'de kanitli). trim yine de duruyor cunku servis
    // ileride uc disindan da cagrilabilir ve normalizasyonun tek yeri burasi.
    const { market, cagrilar } = servisKur(null);

    await market.saticiOlustur(
      KULLANICI,
      { ...gecerliDto(), basvuruEposta: '  Basvuru@Ornek.COM  ' } as CreateSaticiDto,
    );

    expect(cagrilar.create[0].data.basvuruEposta).toBe('basvuru@ornek.com');
  });

  it('yetkili adi ve unvanlar trim edilir', async () => {
    const { market, cagrilar } = servisKur(null);

    await market.saticiOlustur(
      KULLANICI,
      gecerliDto({ yetkiliAdSoyad: '  Ayse Yilmaz  ', legalName: '  Unvan A.S.  ' }),
    );

    expect(cagrilar.create[0].data.yetkiliAdSoyad).toBe('Ayse Yilmaz');
    expect(cagrilar.create[0].data.legalName).toBe('Unvan A.S.');
  });
});

describe('T2/T3 — yan etki YOK', () => {
  it('magaza yaratilmaz, rol degistirilmez', async () => {
    const { market, prisma } = servisKur(null);

    await market.saticiOlustur(KULLANICI, gecerliDto());

    // Sahte prisma'da store/userRole/user YUZEYI HIC TANIMLI DEGIL. Servis
    // onlara dokunsaydi test "cannot read property of undefined" ile duserdi -
    // yani bu, unutulan bir assert degil, YAPISAL bir kanit.
    expect((prisma as any).store).toBeUndefined();
    expect((prisma as any).userRole).toBeUndefined();
    expect((prisma as any).user).toBeUndefined();
  });
});

describe('T4/T13 — idempotent resume', () => {
  it('mevcut satici varsa YENI kayit acilmaz', async () => {
    const { market, cagrilar } = servisKur({ id: 'mevcut-id' });

    await market.saticiOlustur(KULLANICI, gecerliDto());

    expect(cagrilar.create).toHaveLength(0);
  });

  it('govde farkli olsa bile mevcut alanlar EZILMEZ', async () => {
    const { market, cagrilar } = servisKur({ id: 'mevcut-id' });

    const sonuc = await market.saticiOlustur(
      KULLANICI,
      gecerliDto({ legalName: 'BASKA UNVAN', displayName: 'BASKA AD' }),
    );

    expect(cagrilar.create).toHaveLength(0);
    // Yanit mevcut kaydin degerlerini tasir, govdenin degil.
    expect(sonuc.legalName).toBe('MEVCUT UNVAN');
    expect(sonuc.displayName).toBe('MEVCUT AD');
  });
});

describe('T9 — satici dikeyi beyaz listesi', () => {
  it.each([BusinessUnit.MARKET, BusinessUnit.YEMEK, BusinessUnit.CARSI, BusinessUnit.COFFEE, BusinessUnit.LOAD])(
    '%s kabul edilir',
    async (dikey) => {
      const { market, cagrilar } = servisKur(null);
      await market.saticiOlustur(KULLANICI, gecerliDto({ talepEdilenDikey: dikey }));
      expect(cagrilar.create).toHaveLength(1);
    },
  );

  it.each([BusinessUnit.PLATFORM, BusinessUnit.COURIER, BusinessUnit.SIGORTA, BusinessUnit.DICLEFUL])(
    '%s 400 ile reddedilir (gecerli enum ama satici dikeyi degil)',
    async (dikey) => {
      const { market, cagrilar } = servisKur(null);
      await expect(
        market.saticiOlustur(KULLANICI, gecerliDto({ talepEdilenDikey: dikey })),
      ).rejects.toBeInstanceOf(BadRequestException);
      // Reddedilen istek DB'ye HIC gitmemeli.
      expect(cagrilar.create).toHaveLength(0);
      expect(cagrilar.findFirst).toHaveLength(0);
    },
  );
});

describe('T10/T11 — vergi kimligi', () => {
  it('sifreleme YEREL .env DEGERINI KULLANMIYOR (hermetiklik kaniti)', () => {
    // KANIT (A): kullanilan anahtar bu paketin URETTIGI anahtardir. Yerelde
    // .env bir deger tasisa bile o deger DEVREDE DEGIL - yani bu paket .env
    // olmadan da (CI'daki gibi) ayni sekilde calisir.
    expect(process.env.VERGI_KIMLIK_ANAHTARI).toBe(testAnahtari);
    expect(testAnahtari).toHaveLength(64); // 32 bayt hex
    if (oncekiVergiKimlikAnahtari !== undefined) {
      // Degerler RAPORLANMAZ, yalnizca FARKLI olduklari dogrulanir.
      expect(testAnahtari).not.toBe(oncekiVergiKimlikAnahtari);
    }
  });

  it('taxIdentifier YOKSA kayit acilir ve alan yazilmaz', async () => {
    const { market, cagrilar } = servisKur(null);

    await market.saticiOlustur(KULLANICI, gecerliDto());

    expect(cagrilar.create).toHaveLength(1);
    expect(cagrilar.create[0].data.taxIdentifier).toBeUndefined();
    expect(cagrilar.create[0].data.taxLast4).toBeUndefined();
  });

  it('taxIdentifier VARSA sifrelenir, duz metin kolona YAZILMAZ', async () => {
    const { market, cagrilar } = servisKur(null);

    await market.saticiOlustur(KULLANICI, gecerliDto({ taxIdentifier: '1234567890' }));

    const data = cagrilar.create[0].data;
    expect(data.taxIdentifier).toBeDefined();
    expect(data.taxIdentifier).not.toBe('1234567890');
    expect(String(data.taxIdentifier)).toMatch(/^v1:/); // gizli-alan.ts blob bicimi
    expect(data.taxLast4).toBe('7890');
    // saticiGuncelle ile AYNI davranis: kimlik verilince dogrulama beklemeye duser.
    expect(data.verification).toBe(SellerVerification.BEKLIYOR);
  });

  it('yanit ciphertext TASIMAZ', async () => {
    const { market } = servisKur(null);

    const sonuc = await market.saticiOlustur(KULLANICI, gecerliDto({ taxIdentifier: '1234567890' }));

    expect(JSON.stringify(sonuc)).not.toContain('v1:');
    expect(sonuc).not.toHaveProperty('taxIdentifier');
  });
});

describe('T6 — ownerUserId govdeden GECMEZ', () => {
  // ValidationPipe main.ts'teki AYNI secenklerle kuruluyor: whitelist +
  // forbidNonWhitelisted. Bu, "DTO'da olmayan alan gonderilirse ne olur"
  // sorusunun uretimdeki cevabidir.
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const meta = { type: 'body' as const, metatype: CreateSaticiDto };

  it('ownerUserId gonderilirse istek 400 ile reddedilir', async () => {
    await expect(
      pipe.transform({ ...gecerliDto(), ownerUserId: BASKA_KULLANICI }, meta),
    ).rejects.toBeDefined();
  });

  it.each(['status', 'verification', 'roles', 'isActive'])(
    '%s gonderilirse istek 400 ile reddedilir',
    async (alan) => {
      await expect(pipe.transform({ ...gecerliDto(), [alan]: 'X' }, meta)).rejects.toBeDefined();
    },
  );

  it('servis ownerUserId olarak DAIMA cagrilan userId yazar', async () => {
    const { market, cagrilar } = servisKur(null);

    // Govde tipi disi bir alan tasisa bile (pipe atlansa dahi) servis onu okumaz.
    await market.saticiOlustur(KULLANICI, {
      ...gecerliDto(),
      ownerUserId: BASKA_KULLANICI,
    } as unknown as CreateSaticiDto);

    expect(cagrilar.create[0].data.ownerUserId).toBe(KULLANICI);
  });
});

describe('T7/T8 — DTO dogrulamasi', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const meta = { type: 'body' as const, metatype: CreateSaticiDto };

  it('gecerli govde kabul edilir', async () => {
    await expect(pipe.transform(gecerliDto(), meta)).resolves.toBeDefined();
  });

  // Sondaki bosluk BILINCLI olarak listede: @IsEmail cevredeki boslugu kabul
  // ETMIYOR. Bu, servisteki trim'in HTTP yolundan neden tetiklenmedigini
  // sabitleyen kanittir - davranis ileride degisirse bu test uyarir.
  it.each(['duz-metin', 'a@', '@b.com', '', 'a@b.com ', ' a@b.com'])(
    'gecersiz e-posta reddedilir: "%s"',
    async (eposta) => {
      await expect(pipe.transform(gecerliDto({ basvuruEposta: eposta }), meta)).rejects.toBeDefined();
    },
  );

  it('gecersiz sellerType reddedilir', async () => {
    await expect(
      pipe.transform({ ...gecerliDto(), sellerType: 'UYDURMA' }, meta),
    ).rejects.toBeDefined();
  });

  it('gecersiz BusinessUnit reddedilir (DTO seviyesi)', async () => {
    await expect(
      pipe.transform({ ...gecerliDto(), talepEdilenDikey: 'UYDURMA' }, meta),
    ).rejects.toBeDefined();
  });

  it.each(['yetkiliAdSoyad', 'basvuruEposta', 'legalName', 'displayName', 'sellerType', 'talepEdilenDikey'])(
    '%s zorunludur',
    async (alan) => {
      const govde: any = gecerliDto();
      delete govde[alan];
      await expect(pipe.transform(govde, meta)).rejects.toBeDefined();
    },
  );

  it('taxIdentifier OPSIYONELDIR (owner karari OD-5)', async () => {
    const govde: any = gecerliDto();
    expect(govde.taxIdentifier).toBeUndefined();
    await expect(pipe.transform(govde, meta)).resolves.toBeDefined();
  });

  it('gecersiz taxIdentifier reddedilir', async () => {
    await expect(
      pipe.transform(gecerliDto({ taxIdentifier: '123' }), meta),
    ).rejects.toBeDefined();
  });
});
