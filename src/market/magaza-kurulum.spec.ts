// S4.4 — ILK MAGAZA KURULUMU (POST /market/stores) — BIRIM TESTLERI.
//
// Bu paket SOZLESMEYI kanitlar: kapi sirasi (satici -> kilit -> satici/owner/
// dikey/ilk-magaza kontrolleri -> create -> audit, hepsi TEK tx), businessUnit'in
// yalniz talepEdilenDikey'den gelmesi, govdeden businessUnit/sellerId/ownerId
// kabul edilmemesi (main.ts ValidationPipe), otomatik DRAFT Seller yaratilmamasi,
// rol yazilmamasi, yanit allow-list'i ve slug P2002 -> 409. Gercek DB davranisi
// (kilit/yaris, rollback, dikey izolasyonu) magaza-kurulum.int.spec.ts'te.
//
// SAHTE TX = KATI: seller.create / userRole.* gibi tanimsiz bir metoda
// dokunulursa TypeError ile test duser.
import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
import { BusinessUnit, SellerStatus, UserStatus } from '@prisma/client';
import { MarketService } from './market.service';
import { SellerStatusService } from './seller-status.service';
import { CreateStoreDto } from './dto/create-store.dto';
import { AuditService } from '../common/audit/audit.service';
import { SozlesmeService } from '../sozlesme/sozlesme.service';
import { PrismaService } from '../prisma/prisma.service';

const SATICI_ID = '33333333-3333-3333-3333-333333333333';
const SAHIP_ID = '44444444-4444-4444-4444-444444444444';
const IZINLI = [
  'businessUnit', 'city', 'createdAt', 'description', 'district', 'id', 'isActive', 'line1', 'logoUrl',
  'minOrder', 'name', 'phone', 'slug', 'type',
];

function kur(o: {
  satici?: Record<string, unknown> | null;
  owner?: Record<string, unknown> | null;
  magazaSayisi?: number;
  createHata?: unknown;
} = {}) {
  const satici = o.satici === undefined
    ? { id: SATICI_ID, status: SellerStatus.ACTIVE, deletedAt: null, talepEdilenDikey: BusinessUnit.YEMEK }
    : o.satici;
  const owner = o.owner === undefined ? { status: UserStatus.ACTIVE, deletedAt: null } : o.owner;
  const sira: string[] = [];
  const tx = {
    $queryRaw: jest.fn(async () => { sira.push('kilit'); return []; }),
    seller: {
      findFirst: jest.fn(async () => { sira.push('seller.findFirst'); return satici && { id: satici.id }; }),
      findUniqueOrThrow: jest.fn(async () => { sira.push('seller.oku'); return satici; }),
    },
    user: { findUnique: jest.fn(async () => { sira.push('owner'); return owner; }) },
    store: {
      count: jest.fn(async () => { sira.push('store.count'); return o.magazaSayisi ?? 0; }),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data, select }: { data: Record<string, unknown>; select: Record<string, boolean> }) => {
        sira.push('store.create');
        if (o.createHata) throw o.createHata;
        const satir: Record<string, unknown> = {
          ...data, id: 'yeni-magaza', createdAt: new Date(), commissionRate: 1000, deliveryZoneRevision: 0, deletedAt: null,
        };
        return Object.fromEntries(Object.keys(select).map((k) => [k, satir[k]]));
      }),
    },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  const audit = { recordWithTx: jest.fn(async () => { sira.push('audit'); }), record: jest.fn() };
  const market = new MarketService(
    prisma as unknown as PrismaService, audit as unknown as AuditService, new SellerStatusService(), {} as unknown as SozlesmeService,
  );
  return { market, prisma, tx, audit, sira };
}

const dto = { name: 'Lezzet Duragi' } as CreateStoreDto;

describe('S4.4 — basari yolu', () => {
  it('sira: satici -> KILIT -> satici yeniden okuma -> owner -> ilk magaza -> create -> audit; TEK tx', async () => {
    const k = kur();
    await k.market.create(SAHIP_ID, dto, '10.4.4.1');
    expect(k.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(k.sira).toEqual(['seller.findFirst', 'kilit', 'seller.oku', 'owner', 'store.count', 'store.create', 'audit']);
  });

  it.each([BusinessUnit.MARKET, BusinessUnit.YEMEK, BusinessUnit.CARSI])(
    'talepEdilenDikey %s -> magaza o dikeyde, isActive=true, ownerId/sellerId dogru',
    async (dikey) => {
      const k = kur({ satici: { id: SATICI_ID, status: SellerStatus.ACTIVE, deletedAt: null, talepEdilenDikey: dikey } });
      const r = await k.market.create(SAHIP_ID, dto);
      const data = k.tx.store.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ ownerId: SAHIP_ID, sellerId: SATICI_ID, businessUnit: dikey, isActive: true });
      expect(r).toMatchObject({ businessUnit: dikey, isActive: true });
    },
  );

  it('audit: store.create, ayni tx, metadata {sellerId, businessUnit, ilkMagaza:true}', async () => {
    const k = kur();
    await k.market.create(SAHIP_ID, dto, '10.4.4.1');
    expect(k.audit.recordWithTx).toHaveBeenCalledWith(k.tx, {
      actorId: SAHIP_ID, action: 'store.create', entity: 'Store', entityId: 'yeni-magaza', ip: '10.4.4.1',
      metadata: { sellerId: SATICI_ID, businessUnit: BusinessUnit.YEMEK, ilkMagaza: true },
    });
    expect(k.audit.record).not.toHaveBeenCalled();
  });

  it('yanit ALLOW-LIST: ownerId/sellerId/commissionRate/deletedAt/revision yok', async () => {
    const k = kur();
    const r = await k.market.create(SAHIP_ID, dto);
    expect(Object.keys(k.tx.store.create.mock.calls[0][0].select).sort()).toEqual(IZINLI);
    expect(Object.keys(r).sort()).toEqual(IZINLI);
    for (const gizli of ['ownerId', 'sellerId', 'commissionRate', 'deletedAt', 'deliveryZoneRevision']) {
      expect(r).not.toHaveProperty(gizli);
    }
  });
});

describe('S4.4 — kapilar: 409 ve create/audit YOK', () => {
  const yazmaYok = (k: ReturnType<typeof kur>) => {
    expect(k.tx.store.create).not.toHaveBeenCalled();
    expect(k.audit.recordWithTx).not.toHaveBeenCalled();
  };

  it('satici kaydi yok -> 409, otomatik DRAFT Seller YARATILMAZ (seller.create yok)', async () => {
    const k = kur({ satici: null });
    await expect(k.market.create(SAHIP_ID, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(k.tx.$queryRaw).not.toHaveBeenCalled();
    expect((k.tx.seller as Record<string, unknown>).create).toBeUndefined();
    yazmaYok(k);
  });

  it.each([
    SellerStatus.DRAFT, SellerStatus.UNDER_REVIEW, SellerStatus.NEEDS_FIX, SellerStatus.REJECTED,
    SellerStatus.SUSPENDED, SellerStatus.CLOSED,
  ])('satici %s -> 409', async (status) => {
    const k = kur({ satici: { id: SATICI_ID, status, deletedAt: null, talepEdilenDikey: BusinessUnit.MARKET } });
    await expect(k.market.create(SAHIP_ID, dto)).rejects.toBeInstanceOf(ConflictException);
    yazmaYok(k);
  });

  it('satici kilitten sonra silinmis gorunurse -> 409', async () => {
    const k = kur({ satici: { id: SATICI_ID, status: SellerStatus.ACTIVE, deletedAt: new Date(), talepEdilenDikey: BusinessUnit.MARKET } });
    await expect(k.market.create(SAHIP_ID, dto)).rejects.toBeInstanceOf(ConflictException);
    yazmaYok(k);
  });

  it.each([
    ['yok', null],
    ['soft-deleted', { status: UserStatus.ACTIVE, deletedAt: new Date() }],
    ['SUSPENDED', { status: UserStatus.SUSPENDED, deletedAt: null }],
    ['BANNED', { status: UserStatus.BANNED, deletedAt: null }],
    ['DELETED', { status: UserStatus.DELETED, deletedAt: null }],
  ])('owner %s -> 409', async (_ad, owner) => {
    const k = kur({ owner });
    await expect(k.market.create(SAHIP_ID, dto)).rejects.toBeInstanceOf(ConflictException);
    yazmaYok(k);
  });

  it.each([null, BusinessUnit.LOAD, BusinessUnit.COFFEE, BusinessUnit.PLATFORM])('talepEdilenDikey %s -> 409', async (dikey) => {
    const k = kur({ satici: { id: SATICI_ID, status: SellerStatus.ACTIVE, deletedAt: null, talepEdilenDikey: dikey } });
    await expect(k.market.create(SAHIP_ID, dto)).rejects.toBeInstanceOf(ConflictException);
    yazmaYok(k);
  });

  it('saticinin magazasi zaten var -> 409 (sessiz idempotent basari YOK)', async () => {
    const k = kur({ magazaSayisi: 1 });
    await expect(k.market.create(SAHIP_ID, dto)).rejects.toThrow('Satıcının ilk mağazası zaten kurulmuş');
    yazmaYok(k);
  });

  it('slug unique yarisi (P2002) -> 409, kontrolsuz 500 degil', async () => {
    const k = kur({ createHata: Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }) });
    await expect(k.market.create(SAHIP_ID, dto)).rejects.toBeInstanceOf(ConflictException);
    expect(k.audit.recordWithTx).not.toHaveBeenCalled();
  });

  it('P2002 disindaki hata aynen yukari cikar (yutulmaz)', async () => {
    const k = kur({ createHata: new Error('baska hata') });
    await expect(k.market.create(SAHIP_ID, dto)).rejects.toThrow('baska hata');
  });
});

describe('S4.4 — govde (main.ts ValidationPipe)', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const dogrula = (govde: unknown) => pipe.transform(govde, { type: 'body', metatype: CreateStoreDto });

  it.each([
    ['businessUnit', { name: 'X', businessUnit: 'MARKET' }],
    ['sellerId', { name: 'X', sellerId: SATICI_ID }],
    ['ownerId', { name: 'X', ownerId: SAHIP_ID }],
    ['isActive', { name: 'X', isActive: false }],
    ['commissionRate', { name: 'X', commissionRate: 0 }],
  ])('istemci %s gonderemez -> 400', async (_ad, govde) => {
    await expect(dogrula(govde)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('yalniz ad ile gecer', async () => {
    await expect(dogrula({ name: 'Lezzet Duragi' })).resolves.toBeDefined();
  });
});
