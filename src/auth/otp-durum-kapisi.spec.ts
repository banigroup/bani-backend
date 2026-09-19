// AUTH-HIGH-001 — OTP GIRISI VE OTURUM KAPISI: KULLANICI DURUMU (UserStatus).
//
// KANITLANAN SOZLESME (owner politikasi, LOCKED):
//   NEW       -> 200, ACTIVE acilir, token VAR
//   ACTIVE    -> 200, ACTIVE kalir, token VAR
//   PENDING   -> 200, ACTIVE olur (kosullu yazim), token VAR
//   SUSPENDED -> 403, SUSPENDED kalir, token/refresh/rol YOK
//   BANNED    -> 403, BANNED kalir,    token/refresh/rol YOK
//   DELETED   -> 403, DELETED kalir,   token/refresh/rol YOK
// JwtStrategy: SUSPENDED/BANNED/DELETED -> 401, ACTIVE/PENDING -> gecer.
//
// SAHTE PRISMA = BELLEK ICI KULLANICI TABLOSU: upsert/updateMany gercek
// Prisma semantigiyle (where + data) uygulanir; testler "status HANGI degere
// yazildi" sorusunu dogrudan tablodan okur. OTP, SMS, Redis YOK - OtpService
// sahte (verify basarili), TokenService sahte (cagri sayilari olculur).
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

const TELEFON = '+905550000001';
const KULLANICI_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

type Satir = { id: string; phone: string; phoneVerified: boolean; status: UserStatus };

function ortamKur(mevcut: { status: UserStatus; roller?: Role[]; phoneVerified?: boolean } | null) {
  const kullanicilar = new Map<string, Satir>();
  const roller: { userId: string; role: Role; storeId: string | null }[] = [];
  if (mevcut) {
    kullanicilar.set(TELEFON, {
      id: KULLANICI_ID, phone: TELEFON, phoneVerified: mevcut.phoneVerified ?? false, status: mevcut.status,
    });
    for (const role of mevcut.roller ?? []) roller.push({ userId: KULLANICI_ID, role, storeId: null });
  }
  const yazmalar: string[] = [];

  const prisma = {
    user: {
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const var_ = kullanicilar.get(where.phone);
        if (var_) {
          Object.assign(var_, update);
          return { ...var_ };
        }
        const yeni = { id: KULLANICI_ID, ...create } as Satir;
        kullanicilar.set(where.phone, yeni);
        return { ...yeni };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        yazmalar.push('user.updateMany');
        const s = [...kullanicilar.values()].find((u) => u.id === where.id && u.status === where.status);
        if (!s) return { count: 0 };
        Object.assign(s, data);
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        const s = [...kullanicilar.values()].find((u) => u.id === where.id);
        if (!s) throw new Error('bulunamadi');
        return { ...s };
      }),
    },
    userRole: {
      findMany: jest.fn(async ({ where }: any) =>
        roller.filter((r) => r.userId === where.userId && r.storeId === where.storeId).map((r) => ({ role: r.role }))),
      deleteMany: jest.fn(async ({ where }: any) => {
        yazmalar.push('userRole.deleteMany');
        for (let i = roller.length - 1; i >= 0; i--) {
          if (roller[i].userId === where.userId && roller[i].storeId === null) roller.splice(i, 1);
        }
        return { count: 0 };
      }),
      createMany: jest.fn(async ({ data }: any) => {
        yazmalar.push('userRole.createMany');
        roller.push(...data);
        return { count: data.length };
      }),
    },
    $transaction: jest.fn(async (islemler: Promise<unknown>[]) => Promise.all(islemler)),
  };
  const otp = { verify: jest.fn(async () => true), issue: jest.fn() };
  const tokens = {
    signAccess: jest.fn(() => 'ACCESS'),
    issueRefresh: jest.fn(async () => 'REFRESH'),
  };
  const auth = new AuthService(prisma as any, otp as any, tokens as any, {} as any);
  const durum = () => kullanicilar.get(TELEFON)?.status;
  const platformRolleri = () => roller.filter((r) => r.storeId === null).map((r) => r.role).sort();
  return { auth, prisma, otp, tokens, durum, platformRolleri, yazmalar, kullanicilar };
}

const META = { ip: '127.0.0.1', userAgent: 'jest' };

// ================================================================= izinli durumlar

describe('AUTH-HIGH-001 — izinli durumlar giris yapar', () => {
  it('NEW: kullanici ACTIVE acilir, varsayilan rol CUSTOMER, token + refresh uretilir', async () => {
    const o = ortamKur(null);

    const r = await o.auth.verifyOtp(TELEFON, '123456', META);

    expect(o.durum()).toBe(UserStatus.ACTIVE);
    expect(o.platformRolleri()).toEqual([Role.CUSTOMER]);
    expect(r.user.status).toBe(UserStatus.ACTIVE);
    expect(r.accessToken).toBe('ACCESS');
    expect(r.refreshToken).toBe('REFRESH');
    expect(o.tokens.issueRefresh).toHaveBeenCalledTimes(1);
  });

  it('ACTIVE: ACTIVE kalir, phoneVerified true olur, token uretilir', async () => {
    const o = ortamKur({ status: UserStatus.ACTIVE, roller: [Role.CUSTOMER] });

    const r = await o.auth.verifyOtp(TELEFON, '123456', META);

    expect(o.durum()).toBe(UserStatus.ACTIVE);
    expect(o.kullanicilar.get(TELEFON)!.phoneVerified).toBe(true);
    expect(r.user.status).toBe(UserStatus.ACTIVE);
    expect(o.tokens.signAccess).toHaveBeenCalledTimes(1);
    expect(o.tokens.issueRefresh).toHaveBeenCalledTimes(1);
  });

  it('PENDING: kosullu yazimla ACTIVE olur, token uretilir', async () => {
    const o = ortamKur({ status: UserStatus.PENDING });

    const r = await o.auth.verifyOtp(TELEFON, '123456', META);

    expect(o.durum()).toBe(UserStatus.ACTIVE);
    expect(r.user.status).toBe(UserStatus.ACTIVE);
    expect(o.prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: KULLANICI_ID, status: UserStatus.PENDING },
      data: { status: UserStatus.ACTIVE },
    });
    expect(o.tokens.issueRefresh).toHaveBeenCalledTimes(1);
  });

  it('PENDING yarisi: arada admin askiya aldiysa ACTIVE yazilmaz ve 403, token YOK', async () => {
    const o = ortamKur({ status: UserStatus.PENDING });
    // upsert PENDING dondurdukten sonra, kosullu yazimdan ONCE durum degisir.
    o.prisma.user.updateMany.mockImplementationOnce(async () => {
      o.kullanicilar.get(TELEFON)!.status = UserStatus.SUSPENDED;
      return { count: 0 };
    });

    await expect(o.auth.verifyOtp(TELEFON, '123456', META)).rejects.toBeInstanceOf(ForbiddenException);
    expect(o.durum()).toBe(UserStatus.SUSPENDED);
    expect(o.tokens.signAccess).not.toHaveBeenCalled();
    expect(o.tokens.issueRefresh).not.toHaveBeenCalled();
  });

  it('PENDING yarisi: es zamanli dogrulama zaten ACTIVE yaptiysa giris REDDEDILMEZ', async () => {
    const o = ortamKur({ status: UserStatus.PENDING });
    o.prisma.user.updateMany.mockImplementationOnce(async () => {
      o.kullanicilar.get(TELEFON)!.status = UserStatus.ACTIVE;
      return { count: 0 };
    });

    const r = await o.auth.verifyOtp(TELEFON, '123456', META);

    expect(r.user.status).toBe(UserStatus.ACTIVE);
    expect(o.tokens.issueRefresh).toHaveBeenCalledTimes(1);
  });
});

// ================================================================ yaptirimli durumlar

describe('AUTH-HIGH-001 — yaptirimli durumlar: 403, durum korunur, yan etki YOK', () => {
  it.each([[UserStatus.SUSPENDED], [UserStatus.BANNED], [UserStatus.DELETED]])(
    '%s: 403, status degismez, token/refresh/rol yazimi YOK',
    async (durum) => {
      const o = ortamKur({ status: durum, roller: [Role.CUSTOMER] });

      await expect(o.auth.verifyOtp(TELEFON, '123456', META)).rejects.toThrow(
        new ForbiddenException('Hesabınız kullanıma kapalı.'),
      );

      // Yaptirim KALDIRILMADI.
      expect(o.durum()).toBe(durum);
      // Istisna token/refresh uretiminden ONCE.
      expect(o.tokens.signAccess).not.toHaveBeenCalled();
      expect(o.tokens.issueRefresh).not.toHaveBeenCalled();
      // Rol okunmadi bile, yazilmadi; status icin kosullu yazim da yapilmadi.
      expect(o.prisma.userRole.findMany).not.toHaveBeenCalled();
      expect(o.yazmalar).toEqual([]);
      expect(o.platformRolleri()).toEqual([Role.CUSTOMER]);
      // upsert status'a DOKUNMADI (yalniz phoneVerified).
      expect(o.prisma.user.upsert.mock.calls[0][0].update).toEqual({ phoneVerified: true });
    },
  );

  it('rolsuz yaptirimli hesaba da varsayilan rol YAZILMAZ', async () => {
    const o = ortamKur({ status: UserStatus.BANNED, roller: [] });

    await expect(o.auth.verifyOtp(TELEFON, '123456', META)).rejects.toBeInstanceOf(ForbiddenException);

    expect(o.platformRolleri()).toEqual([]);
    expect(o.yazmalar).toEqual([]);
  });
});

// ======================================================================= roller

describe('AUTH-HIGH-001 — mevcut roller korunur', () => {
  it('ACTIVE ADMIN + LOAD_CUSTOMER: giris rollere dokunmaz, `roller` parametresi yok sayilir', async () => {
    const o = ortamKur({ status: UserStatus.ACTIVE, roller: [Role.ADMIN, Role.LOAD_CUSTOMER] });

    const r = await o.auth.verifyOtp(TELEFON, '123456', META, ['CARRIER']);

    expect(o.platformRolleri()).toEqual([Role.ADMIN, Role.LOAD_CUSTOMER].sort());
    expect([...r.user.roles].sort()).toEqual([Role.ADMIN, Role.LOAD_CUSTOMER].sort());
    expect(o.yazmalar).not.toContain('userRole.deleteMany');
    expect(o.yazmalar).not.toContain('userRole.createMany');
  });

  it('NEW + izinli `roller` (CARRIER): mevcut davranis korunur', async () => {
    const o = ortamKur(null);

    await o.auth.verifyOtp(TELEFON, '123456', META, ['CARRIER', 'ADMIN']);

    // ADMIN izinli listede degil, suzulur.
    expect(o.platformRolleri()).toEqual([Role.CARRIER]);
  });
});

// ================================================================== oturum kapisi

describe('AUTH-HIGH-001 — JwtStrategy durum kapisi (mevcut oturum)', () => {
  function stratejiKur(kullanici: { status: UserStatus } | null) {
    const prisma = {
      user: {
        findUnique: jest.fn(async () =>
          kullanici
            ? { id: KULLANICI_ID, phone: TELEFON, status: kullanici.status, rolAtamalari: [{ role: Role.CUSTOMER, storeId: null }] }
            : null),
      },
    };
    const config = { get: () => 'test-secret' };
    return new JwtStrategy(config as any, prisma as any);
  }
  const PAYLOAD = { sub: KULLANICI_ID, phone: TELEFON, roles: [] } as any;

  it.each([[UserStatus.SUSPENDED], [UserStatus.BANNED], [UserStatus.DELETED]])('%s -> 401', async (durum) => {
    await expect(stratejiKur({ status: durum }).validate(PAYLOAD)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('kullanici yok -> 401', async () => {
    await expect(stratejiKur(null).validate(PAYLOAD)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([[UserStatus.ACTIVE], [UserStatus.PENDING]])('%s -> kabul, roller DB\'den', async (durum) => {
    const u = await stratejiKur({ status: durum }).validate(PAYLOAD);
    expect(u).toEqual({ id: KULLANICI_ID, phone: TELEFON, roles: [Role.CUSTOMER], magazaRolleri: {} });
  });
});
