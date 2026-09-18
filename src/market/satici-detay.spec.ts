// S4.1 — ADMIN SATICI DETAYI (GET /market/sellers/:id) — BIRIM TESTLERI.
//
// Bu paket SOZLESMEYI kanitlar: kim okuyabilir, DB'ye HANGI projeksiyon gider,
// yanit hangi anahtarlari tasir ve hicbir yazma yolu CAGRILMAZ. Gercek DB
// davranisi (iliski suzgeci, soft-delete, gercek izin matrisi) ayri pakette:
// satici-detay.int.spec.ts.
//
// SAHTE PRISMA = PROXY: tanimli okuma metotlari disinda HERHANGI bir model
// metoduna dokunulursa (create/update/upsert/delete... ya da beklenmeyen bir
// okuma) test DUSER. "Yazma yok" iddiasi boylece tek tek sayilan metotlara
// degil, tum yuzeye uygulanir.
import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import {
  BusinessUnit, Role, SaticiBelgeDurum, SaticiBelgeTipi, SellerStatus, SellerType,
  SellerVerification, SozlesmeTipi, UserStatus,
} from '@prisma/client';
import { MarketService } from './market.service';
import { AuditService } from '../common/audit/audit.service';
import { SellerStatusService } from './seller-status.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { PrismaService } from '../prisma/prisma.service';
import { UuidParam } from '../common/pipes/uuid-param.pipe';

const SATICI_ID = '33333333-3333-3333-3333-333333333333';
const SAHIP_ID = '44444444-4444-4444-4444-444444444444';

// SABIT SAAT: bekleme gunu hesabi gun sinirinda kaymasin.
const SIMDI = new Date('2026-09-18T12:00:00.000Z');
const UC_GUN_ONCE = new Date('2026-09-15T11:00:00.000Z');
const GECMIS_TARIH = new Date('2026-09-01T00:00:00.000Z');

const BEKLENEN_SATICI_ALANLARI = [
  'id', 'sellerType', 'legalName', 'displayName', 'taxLast4', 'status', 'verification',
  'verificationExpiresAt', 'yetkiliAdSoyad', 'basvuruEposta', 'talepEdilenDikey', 'redGerekce',
  'createdAt', 'updatedAt',
].sort();
const BEKLENEN_SAHIP_ALANLARI = ['id', 'phone', 'name', 'surname', 'status'].sort();
const BEKLENEN_BELGE_ALANLARI = ['id', 'tip', 'dosyaUrl', 'durum', 'redGerekce', 'createdAt', 'updatedAt'].sort();
const BEKLENEN_SOZLESME_ALANLARI = ['sozlesmeTipi', 'surum', 'metinHash', 'onayTarihi'].sort();

/** Veritabani select'e UYAR gibi davranir: yalnizca istenen alanlari dondurur. */
function secileniDondur(tamSatir: Record<string, any>, select: Record<string, any>) {
  const cikti: Record<string, any> = {};
  for (const [alan, deger] of Object.entries(select)) {
    if (deger === true) cikti[alan] = tamSatir[alan];
  }
  return cikti;
}

/**
 * Tam satir: gizli alanlar DAHIL. Projeksiyon hatasi olursa bu degerler
 * yanita sizar ve testler yakalar.
 */
function tamSaticiSatiri(ustuneYaz: Record<string, any> = {}) {
  return {
    id: SATICI_ID,
    ownerUserId: SAHIP_ID,
    sellerType: SellerType.MARKET,
    legalName: 'Ornek Ticaret Ltd. Sti.',
    displayName: 'Ornek Market',
    taxIdentifier: 'v1:iv:tag:SIFRELI-BLOB',
    taxLast4: '9999',
    status: SellerStatus.UNDER_REVIEW,
    verification: SellerVerification.BEKLIYOR,
    verificationExpiresAt: null,
    yetkiliAdSoyad: 'Ayse Yilmaz',
    basvuruEposta: 'basvuru@ornek.com',
    talepEdilenDikey: BusinessUnit.MARKET,
    redGerekce: null,
    createdAt: UC_GUN_ONCE,
    updatedAt: UC_GUN_ONCE,
    deletedAt: null,
    ...ustuneYaz,
  };
}

const TAM_SAHIP_SATIRI = {
  id: SAHIP_ID,
  phone: '+905551118782',
  phoneVerified: true,
  email: 'gizli@ornek.com',
  name: 'Ayse',
  surname: 'Yilmaz',
  passwordHash: 'GIZLI-HASH',
  status: UserStatus.ACTIVE,
  createdAt: UC_GUN_ONCE,
  updatedAt: UC_GUN_ONCE,
  deletedAt: null,
  otpRequests: [{ code: '123456' }],
  refreshTokens: [{ token: 'GIZLI-TOKEN' }],
};

function tamBelgeSatiri(id: string, ustuneYaz: Record<string, any> = {}) {
  return {
    id,
    sellerId: SATICI_ID,
    tip: SaticiBelgeTipi.VERGI_LEVHASI,
    dosyaUrl: `https://res.cloudinary.com/x/${id}.pdf`,
    durum: SaticiBelgeDurum.BEKLIYOR,
    redGerekce: null,
    deletedAt: null,
    createdAt: UC_GUN_ONCE,
    updatedAt: UC_GUN_ONCE,
    ...ustuneYaz,
  };
}

function tamSozlesmeSatiri(tip: SozlesmeTipi) {
  return {
    id: `onay-${tip}`,
    kullaniciId: SAHIP_ID,
    sozlesmeTipi: tip,
    surum: 'v1.2-2026-08-31',
    metinHash: 'a'.repeat(64),
    ip: '10.0.0.1',
    cihaz: 'Mozilla/5.0',
    onayTarihi: UC_GUN_ONCE,
    createdAt: UC_GUN_ONCE,
  };
}

/**
 * Proxy tabanli sahte prisma. `okumalar` disindaki her metot cagrisi
 * `yasakCagrilar`a yazilir ve HATA firlatir.
 */
function sahtePrisma(okumalar: Record<string, Record<string, (arg: any) => any>>) {
  const yasakCagrilar: string[] = [];
  const cagrilar: Record<string, any[]> = {};
  const modelProxy = (model: string) =>
    new Proxy({}, {
      get: (_hedef, metot: string) => {
        const okuma = okumalar[model]?.[metot];
        if (okuma) {
          return jest.fn(async (arg: any) => {
            (cagrilar[`${model}.${metot}`] ??= []).push(arg);
            return okuma(arg);
          });
        }
        return jest.fn(() => {
          yasakCagrilar.push(`${model}.${metot}`);
          throw new Error(`BEKLENMEYEN PRISMA CAGRISI: ${model}.${metot}`);
        });
      },
    });
  const prisma = new Proxy({}, {
    get: (_hedef, ad: string) => {
      if (ad === '$transaction') {
        // Yalnizca DIZI bicimi (okuma toplu calistirma) - saticiListele boyle
        // kullaniyor. Fonksiyon bicimi (interaktif, yazma icin) YASAK.
        return jest.fn(async (arg: any) => {
          if (!Array.isArray(arg)) {
            yasakCagrilar.push('$transaction(fn)');
            throw new Error('BEKLENMEYEN interaktif $transaction');
          }
          return Promise.all(arg);
        });
      }
      if (ad.startsWith('$')) {
        return jest.fn(() => {
          yasakCagrilar.push(ad);
          throw new Error(`BEKLENMEYEN PRISMA CAGRISI: ${ad}`);
        });
      }
      return modelProxy(ad);
    },
  });
  return { prisma, yasakCagrilar, cagrilar };
}

/** SozlesmeService: aktif surum yokmus gibi 503 atar - detay ONA HIC DOKUNMAMALI. */
function sozlesmeServisi503() {
  const cagrildi: string[] = [];
  const servis = {
    durum: jest.fn(async () => {
      cagrildi.push('durum');
      throw new ServiceUnavailableException('Bu sozlesme tipi icin aktif surum tanimli degil');
    }),
    onayliMi: jest.fn(async () => {
      cagrildi.push('onayliMi');
      throw new ServiceUnavailableException('Bu sozlesme tipi icin aktif surum tanimli degil');
    }),
  };
  return { servis, cagrildi };
}

function servisKur(
  secenekler: {
    satici?: Record<string, any> | null;
    belgeler?: Record<string, any>[];
    sozlesmeler?: Record<string, any>[];
  } = {},
) {
  const satici = secenekler.satici === undefined ? tamSaticiSatiri() : secenekler.satici;
  const belgeler = secenekler.belgeler ?? [];
  const sozlesmeler = secenekler.sozlesmeler ?? [];

  const { prisma, yasakCagrilar, cagrilar } = sahtePrisma({
    seller: {
      findFirst: (arg) => {
        if (!satici) return null;
        const cikti = secileniDondur(satici, arg.select);
        if (arg.select.owner) cikti.owner = secileniDondur(TAM_SAHIP_SATIRI, arg.select.owner.select);
        if (arg.select.belgeler) {
          cikti.belgeler = belgeler
            .filter((b) => b.deletedAt === null)
            .map((b) => secileniDondur(b, arg.select.belgeler.select));
        }
        return cikti;
      },
      count: () => (satici ? 1 : 0),
      // Liste ucu stores iliskisini de seciyor (ic ice select); sahte DB onu
      // bos dizi olarak doldurur.
      findMany: (arg) => (satici ? [{ ...secileniDondur(satici, arg.select), stores: [] }] : []),
    },
    sozlesmeOnay: {
      findMany: (arg) => sozlesmeler.map((s) => secileniDondur(s, arg.select)),
    },
  });
  const { servis: sozlesme, cagrildi: sozlesmeCagrilari } = sozlesmeServisi503();
  const market = new MarketService(
    prisma as unknown as PrismaService,
    {} as unknown as AuditService,
    {} as unknown as SellerStatusService,
    sozlesme as unknown as SozlesmeService,
  );
  return { market, yasakCagrilar, cagrilar, sozlesmeCagrilari };
}

beforeEach(() => {
  jest.useFakeTimers({ now: SIMDI });
});

afterEach(() => {
  jest.useRealTimers();
});

// ======================================================================= yetki

describe('S4.1 yetki — servis ikinci savunmasi', () => {
  it.each([[Role.ADMIN], [Role.SUPER_ADMIN]])('%s detayi okuyabilir', async (rol) => {
    const { market, yasakCagrilar } = servisKur();

    const r = await market.saticiDetay([rol], SATICI_ID);

    expect(r.seller.id).toBe(SATICI_ID);
    expect(yasakCagrilar).toEqual([]);
  });

  it.each([[Role.CUSTOMER], [Role.MERCHANT]])('%s okuyamaz (403) ve DB sorgusu yapilmaz', async (rol) => {
    const { market, cagrilar } = servisKur();

    await expect(market.saticiDetay([rol], SATICI_ID)).rejects.toBeInstanceOf(ForbiddenException);
    expect(cagrilar).toEqual({});
  });
});

// ================================================================== hata sozlesmesi

describe('S4.1 hata sozlesmesi', () => {
  it('satici bulunamazsa 404 "Satıcı bulunamadı"', async () => {
    const { market } = servisKur({ satici: null });

    await expect(market.saticiDetay([Role.ADMIN], SATICI_ID)).rejects.toThrow(
      new NotFoundException('Satıcı bulunamadı'),
    );
  });

  it('soft-delete edilmis satici sorgudan dislanir (where deletedAt: null) -> 404', async () => {
    const { market, cagrilar } = servisKur({ satici: null });

    await expect(market.saticiDetay([Role.ADMIN], SATICI_ID)).rejects.toBeInstanceOf(NotFoundException);
    expect(cagrilar['seller.findFirst'][0].where).toEqual({ id: SATICI_ID, deletedAt: null });
  });

  it('UUID olmayan kimlik 400 "Geçersiz kimlik biçimi (UUID bekleniyor)"', async () => {
    await expect(UuidParam.transform('abc', { type: 'param' } as never)).rejects.toThrow(
      new BadRequestException('Geçersiz kimlik biçimi (UUID bekleniyor)'),
    );
  });

  it('gecerli UUID pipe\'tan aynen gecer', async () => {
    await expect(UuidParam.transform(SATICI_ID, { type: 'param' } as never)).resolves.toBe(SATICI_ID);
  });
});

// ====================================================================== projeksiyon

describe('S4.1 projeksiyon — izin listesi', () => {
  it('seller select anahtarlari BIREBIR izin listesi (+ owner, belgeler iliskisi)', async () => {
    const { market, cagrilar } = servisKur();

    await market.saticiDetay([Role.ADMIN], SATICI_ID);

    const select = cagrilar['seller.findFirst'][0].select;
    const duzAlanlar = Object.keys(select).filter((k) => select[k] === true).sort();
    expect(duzAlanlar).toEqual(BEKLENEN_SATICI_ALANLARI);
    expect(Object.keys(select).sort()).toEqual([...BEKLENEN_SATICI_ALANLARI, 'belgeler', 'owner'].sort());
    // Gizli alan DB'den HIC cekilmiyor.
    expect(select.taxIdentifier).toBeUndefined();
    expect(select.ownerUserId).toBeUndefined();
    expect(select.deletedAt).toBeUndefined();
  });

  it('yanitin seller bolumu yalnizca izin listesi; taxIdentifier YOK', async () => {
    const { market } = servisKur();

    const r = await market.saticiDetay([Role.ADMIN], SATICI_ID);

    expect(Object.keys(r).sort()).toEqual(['belgeler', 'inceleme', 'owner', 'seller', 'sozlesmeOnaylari']);
    expect(Object.keys(r.seller).sort()).toEqual(BEKLENEN_SATICI_ALANLARI);
    expect(r.seller).not.toHaveProperty('taxIdentifier');
    expect(r.seller.taxLast4).toBe('9999');
    expect(JSON.stringify(r)).not.toContain('SIFRELI-BLOB');
  });

  it('owner select ve yanit yalnizca id/phone/name/surname/status; telefon TAM', async () => {
    const { market, cagrilar } = servisKur();

    const r = await market.saticiDetay([Role.ADMIN], SATICI_ID);

    expect(Object.keys(cagrilar['seller.findFirst'][0].select.owner.select).sort()).toEqual(BEKLENEN_SAHIP_ALANLARI);
    expect(Object.keys(r.owner).sort()).toEqual(BEKLENEN_SAHIP_ALANLARI);
    expect(r.owner.phone).toBe('+905551118782');
  });

  it('passwordHash ve auth/guvenlik iliskileri yanitta YOK', async () => {
    const { market } = servisKur();

    const r = await market.saticiDetay([Role.ADMIN], SATICI_ID);

    const metin = JSON.stringify(r);
    for (const gizli of ['passwordHash', 'GIZLI-HASH', 'otpRequests', 'refreshTokens', 'GIZLI-TOKEN',
      'socialIdentities', 'wallets', 'phoneVerified', 'gizli@ornek.com']) {
      expect(metin).not.toContain(gizli);
    }
  });
});

// ========================================================================= belgeler

describe('S4.1 belgeler — detaya gomulu', () => {
  it('belgeler satici iliskisi uzerinden, deletedAt: null + createdAt desc ile okunur', async () => {
    const { market, cagrilar } = servisKur();

    await market.saticiDetay([Role.ADMIN], SATICI_ID);

    const belgeSecimi = cagrilar['seller.findFirst'][0].select.belgeler;
    expect(belgeSecimi.where).toEqual({ deletedAt: null });
    expect(belgeSecimi.orderBy).toEqual({ createdAt: 'desc' });
    expect(Object.keys(belgeSecimi.select).sort()).toEqual(BEKLENEN_BELGE_ALANLARI);
    // Ayri bir saticiBelge sorgusu YOK: kapsam iliskiden gelir.
    expect(cagrilar['saticiBelge.findMany']).toBeUndefined();
  });

  it('soft-delete edilmis belge donmez; donen belge yalnizca izin listesi alanlarini tasir', async () => {
    const { market } = servisKur({
      belgeler: [tamBelgeSatiri('b-aktif'), tamBelgeSatiri('b-silik', { deletedAt: GECMIS_TARIH })],
    });

    const r = await market.saticiDetay([Role.ADMIN], SATICI_ID);

    expect(r.belgeler.map((b: any) => b.id)).toEqual(['b-aktif']);
    expect(Object.keys(r.belgeler[0]).sort()).toEqual(BEKLENEN_BELGE_ALANLARI);
    expect(r.belgeler[0]).not.toHaveProperty('sellerId');
    expect(r.belgeler[0]).not.toHaveProperty('deletedAt');
  });

  it('0 belge -> []', async () => {
    const { market } = servisKur({ belgeler: [] });

    const r = await market.saticiDetay([Role.ADMIN], SATICI_ID);

    expect(r.belgeler).toEqual([]);
  });
});

// ======================================================================= sozlesmeler

describe('S4.1 sozlesme onaylari — dogrudan salt-okunur projeksiyon', () => {
  it('sorgu owner kullanicisina ve SATICI/SATICI_KOMISYON tiplerine kapsanir; ip/cihaz secilmez', async () => {
    const { market, cagrilar } = servisKur();

    await market.saticiDetay([Role.ADMIN], SATICI_ID);

    const arg = cagrilar['sozlesmeOnay.findMany'][0];
    expect(arg.where).toEqual({
      kullaniciId: SAHIP_ID,
      sozlesmeTipi: { in: [SozlesmeTipi.SATICI, SozlesmeTipi.SATICI_KOMISYON] },
    });
    expect(Object.keys(arg.select).sort()).toEqual(BEKLENEN_SOZLESME_ALANLARI);
  });

  it('yanitta ip/cihaz YOK', async () => {
    const { market } = servisKur({
      sozlesmeler: [tamSozlesmeSatiri(SozlesmeTipi.SATICI), tamSozlesmeSatiri(SozlesmeTipi.SATICI_KOMISYON)],
    });

    const r = await market.saticiDetay([Role.ADMIN], SATICI_ID);

    expect(r.sozlesmeOnaylari).toHaveLength(2);
    for (const s of r.sozlesmeOnaylari) {
      expect(Object.keys(s).sort()).toEqual(BEKLENEN_SOZLESME_ALANLARI);
    }
    expect(JSON.stringify(r)).not.toContain('10.0.0.1');
    expect(JSON.stringify(r)).not.toContain('Mozilla');
  });

  it('aktif surum yokken (SozlesmeService 503 atarken) detay 503 URETMEZ', async () => {
    const { market, sozlesmeCagrilari } = servisKur();

    await expect(market.saticiDetay([Role.ADMIN], SATICI_ID)).resolves.toBeDefined();
    // durum/onayliMi hic cagrilmadi; sozlesmeVersiyon da okunmadi (Proxy
    // okunsaydi yasak cagri olarak dusururdu).
    expect(sozlesmeCagrilari).toEqual([]);
  });

  it('0 sozlesme onayi -> []', async () => {
    const { market } = servisKur({ sozlesmeler: [] });

    const r = await market.saticiDetay([Role.ADMIN], SATICI_ID);

    expect(r.sozlesmeOnaylari).toEqual([]);
  });
});

// ==================================================================== inceleme meta

describe('S4.1 inceleme meta — liste ile ayni hesap', () => {
  it.each([
    ['UNDER_REVIEW, dogrulama suresi yok', {}],
    ['ONAYLANDI + suresi gecmis (tutarsiz)', {
      verification: SellerVerification.ONAYLANDI, verificationExpiresAt: GECMIS_TARIH,
    }],
    ['ACTIVE (bekleme gunu null)', { status: SellerStatus.ACTIVE, verification: SellerVerification.ONAYLANDI }],
  ])('%s', async (_ad, ustuneYaz) => {
    const { market } = servisKur({ satici: tamSaticiSatiri(ustuneYaz) });
    const liste = await market.saticiListele([Role.ADMIN], (ustuneYaz as any).status ?? 'UNDER_REVIEW');
    const detay = await market.saticiDetay([Role.ADMIN], SATICI_ID);

    const k = liste.kayitlar[0] as any;
    expect(detay.inceleme).toEqual({
      belgeSuresiGecti: k.belgeSuresiGecti,
      durumTutarsiz: k.durumTutarsiz,
      bekleyenGunSayisi: k.bekleyenGunSayisi,
    });
  });

  it('beklenen degerler: 3 gun bekleme, tutarsizlik yakalanir', async () => {
    const { market } = servisKur({
      satici: tamSaticiSatiri({ verification: SellerVerification.ONAYLANDI, verificationExpiresAt: GECMIS_TARIH }),
    });

    const r = await market.saticiDetay([Role.ADMIN], SATICI_ID);

    expect(r.inceleme).toEqual({ belgeSuresiGecti: true, durumTutarsiz: true, bekleyenGunSayisi: 3 });
  });

  it('liste yanitinin kayit sekli DEGISMEDI (regresyon)', async () => {
    const { market } = servisKur();

    const liste = await market.saticiListele([Role.ADMIN]);

    expect(Object.keys(liste).sort()).toEqual(['durum', 'kayitlar', 'toplam']);
    expect(Object.keys(liste.kayitlar[0]).sort()).toEqual([
      'belgeSuresiGecti', 'bekleyenGunSayisi', 'createdAt', 'displayName', 'durumTutarsiz', 'id',
      'legalName', 'sellerType', 'status', 'stores', 'taxLast4', 'updatedAt', 'verification',
      'verificationExpiresAt',
    ].sort());
  });
});

// ====================================================================== salt okuma

describe('S4.1 SALT OKUMA — hicbir yazma yolu cagrilmaz', () => {
  it('yalnizca seller.findFirst + sozlesmeOnay.findMany; yazma/diger cagri = 0', async () => {
    const { market, yasakCagrilar, cagrilar } = servisKur({
      belgeler: [tamBelgeSatiri('b1')],
      sozlesmeler: [tamSozlesmeSatiri(SozlesmeTipi.SATICI)],
    });

    await market.saticiDetay([Role.SUPER_ADMIN], SATICI_ID);

    // Proxy, izinli iki okuma disindaki HER cagriyi (create, createMany,
    // update, updateMany, upsert, delete, deleteMany, $executeRaw, interaktif
    // $transaction...) yasakCagrilar'a yazar ve firlatir.
    expect(yasakCagrilar).toEqual([]);
    expect(Object.keys(cagrilar).sort()).toEqual(['seller.findFirst', 'sozlesmeOnay.findMany']);
  });

  it('status/verification/rol/magaza modellerine hic dokunulmaz', async () => {
    const { market, cagrilar } = servisKur();

    const r = await market.saticiDetay([Role.ADMIN], SATICI_ID);

    expect(r.seller.status).toBe(SellerStatus.UNDER_REVIEW);
    expect(r.seller.verification).toBe(SellerVerification.BEKLIYOR);
    for (const anahtar of Object.keys(cagrilar)) {
      expect(anahtar).not.toMatch(/^(userRole|store|user|sozlesmeVersiyon|saticiBelge)\./);
    }
    expect(r).not.toHaveProperty('stores');
    expect(r.seller).not.toHaveProperty('stores');
  });
});
