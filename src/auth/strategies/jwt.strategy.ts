import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessPayload } from '../tokens/token.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { rolleriAyir } from '../../common/rbac/kullanici-rolleri';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.accessSecret') ?? 'dev-access',
    });
  }

  // ROLLER TOKEN'DAN DEGIL DB'DEN: payload.roles bilerek yok sayiliyor, boylece
  // rol degisikligi ANINDA etkili olur ve token flush gerekmez. A1'de kaynak
  // user_roles tablosu oldu; iliski ayni sorguya eklendi, yeni gidis-donus YOK.
  //
  // C1: select'e storeId EKLENDI (yeni sorgu yok, ayni include). Roller artik
  // kapsamina gore ayriliyor - ayirma kurali common/rbac/kullanici-rolleri
  // icindeki TEK fonksiyonda. Bugun tum storeId degerleri NULL oldugu icin
  // roles alani A1 sonrasiyla BIREBIR ayni, magazaRolleri bos gelir.
  async validate(payload: AccessPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { rolAtamalari: { select: { role: true, storeId: true } } },
    });
    if (!user || user.status === 'BANNED' || user.status === 'DELETED') {
      throw new UnauthorizedException();
    }
    // Tekillestirme rolleriAyir icinde: bkz. schema UserRole nullable-unique notu.
    const { roles, magazaRolleri } = rolleriAyir(user.rolAtamalari);
    return { id: user.id, phone: user.phone, roles, magazaRolleri };
  }
}
