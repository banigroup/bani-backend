import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UserStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OtpService } from './otp/otp.service';
import { TokenService } from './tokens/token.service';
import { originDikey } from '../common/domain/dikey-domain';
import { rolleriOku, rolleriYaz } from '../common/rbac/kullanici-rolleri';

interface ReqMeta { ip?: string; userAgent?: string }

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
  ) { }

  async requestOtp(phone: string) {
    const code = await this.otp.issue(phone);
    const devCode = (process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_CODE === 'true') ? code : undefined;
    return { sent: true, devCode };
  }

  async verifyOtp(phone: string, code: string, meta: ReqMeta, roller?: string[]) {
    await this.otp.verify(phone, code);
    const user = await this.prisma.user.upsert({
      where: { phone },
      update: { phoneVerified: true, status: UserStatus.ACTIVE },
      create: { phone, phoneVerified: true, status: UserStatus.ACTIVE },
    });
    // ROL ARTIK AYRI TABLODA, upsert'in create daliyla verilemiyor. Eski
    // davranis KORUNUYOR: roller yalnizca YENI kullaniciya atanir, mevcut
    // kullanicininkiler ellenmez (upsert'te create.roles tam bunu yapiyordu).
    // "Yeni" olcusu rol satirinin bulunmamasi; rolsuz kalmis eski bir kayit da
    // boylece onarilir.
    let roles = await rolleriOku(this.prisma, user.id);
    if (roles.length === 0) {
      const izinli = ['LOAD_CUSTOMER', 'CARRIER'];
      const secilen = (roller || []).filter((r) => izinli.includes(r)) as Role[];
      roles = await rolleriYaz(this.prisma, user.id, secilen.length ? secilen : [Role.CUSTOMER]);
    }
    const accessToken = this.tokens.signAccess({ sub: user.id, phone: user.phone, roles });
    const refreshToken = await this.tokens.issueRefresh(user.id, meta);
    return { accessToken, refreshToken, user: { id: user.id, phone: user.phone, roles, status: user.status } };
  }

  // Misafir oturumu: anonim bir kullanici acar ve token verir (login YOK).
  // Sepet + checkout + escrow akisinin aynen calismasi icin gercek bir kullanici satiri gerekir.
  async guestSession(meta: ReqMeta) {
    const user = await this.prisma.user.create({
      data: {
        phone: `guest_${randomUUID()}`,
        phoneVerified: false,
        status: UserStatus.ACTIVE,
      },
    });
    // Kolon default'u ([CUSTOMER]) kolonla birlikte kalkti; rol ACIKCA yaziliyor.
    const roles = await rolleriYaz(this.prisma, user.id, [Role.CUSTOMER]);
    const accessToken = this.tokens.signAccess({ sub: user.id, phone: user.phone, roles });
    const refreshToken = await this.tokens.issueRefresh(user.id, meta);
    return { accessToken, refreshToken, guest: true, user: { id: user.id, phone: user.phone, roles, status: user.status } };
  }

  async refresh(raw: string, meta: ReqMeta) {
    const rotated = await this.tokens.rotateRefresh(raw, meta);
    if (!rotated) return null;
    const { user, refreshToken } = rotated;
    const roles = await rolleriOku(this.prisma, user.id);
    const accessToken = this.tokens.signAccess({ sub: user.id, phone: user.phone, roles });
    return { accessToken, refreshToken };
  }

  // ---------------- CROSS-DOMAIN OTURUM DEVRI ----------------
  // KAYNAK taraf: oturumu olan kullanici, hedef origin icin kisa omurlu bilet alir.
  async transferKoduUret(userId: string, hedefOrigin: string, meta: ReqMeta) {
    return this.tokens.issueTransferCode(userId, hedefOrigin, meta);
  }

  // HEDEF taraf: bileti tuketip TAZE access+refresh alir (yetki gerektirmez -
  // kimlik kanidi kodun kendisidir).
  //
  // SEPET CAKISMASI KURALI: hedefte zaten baska bir oturum varsa ve o oturumun
  // sepeti DOLUYSA devir YAPILMAZ - hedefteki sepet korunur, kaynaktaki aktarilmaz.
  // mevcutToken opsiyoneldir: gonderilmezse cakisma bilinemez ve devir normal isler.
  async transferKoduTuket(kod: string, istekOrigin: string | undefined, mevcutToken: string | undefined, meta: ReqMeta) {
    const user = await this.tokens.consumeTransferCode(kod, istekOrigin);
    if (!user) return null;

    if (mevcutToken) {
      const payload = this.tokens.verifyAccess(mevcutToken);
      if (payload && payload.sub !== user.id) {
        // Sepet dikeye kilitli oldugundan cakisma da DIKEY BAZLIDIR: hedef
        // banikervan ise oradaki carsi sepeti korunur, kullanicinin dolu market
        // sepeti devri bloklamaz. Hedef dikey cozulemezse (ana domain) eski
        // davranis surer: herhangi bir dolu sepet devri durdurur.
        const hedefDikey = originDikey(istekOrigin);
        const doluMu = await this.prisma.cartItem.count({
          where: {
            cart: { userId: payload.sub, ...(hedefDikey ? { businessUnit: hedefDikey } : {}) },
          },
        });
        if (doluMu > 0) {
          // Kod zaten tuketildi (tek kullanimlik); token URETILMEZ ki hedefteki
          // oturum ve sepeti oldugu gibi kalsin.
          return { sepetCakismasi: true as const };
        }
      }
    }

    const roles = await rolleriOku(this.prisma, user.id);
    const accessToken = this.tokens.signAccess({ sub: user.id, phone: user.phone, roles });
    const refreshToken = await this.tokens.issueRefresh(user.id, meta);
    return {
      accessToken,
      refreshToken,
      guest: user.phone.startsWith('guest_'),
      user: { id: user.id, phone: user.phone, roles, status: user.status },
    };
  }

  async logout(raw: string): Promise<{ ok: true }> {
    await this.tokens.revoke(raw);
    return { ok: true };
  }
}
