import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomInt } from 'crypto';
import { OtpPurpose } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SMS_PROVIDER, SmsProvider } from '../../bildirim/sms/sms-provider.interface';

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  private hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private generateCode(): string {
    const len = this.config.get<number>('otp.length', 6);
    const max = 10 ** len;
    return randomInt(0, max).toString().padStart(len, '0');
  }

  async issue(phone: string, purpose: OtpPurpose = OtpPurpose.LOGIN): Promise<string> {
    const cooldown = this.config.get<number>('otp.resendCooldownSeconds', 60);
    const recent = await this.prisma.otpRequest.findFirst({
      where: { phone, createdAt: { gt: new Date(Date.now() - cooldown * 1000) } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) throw new BadRequestException('Çok sık istek. Lütfen bekleyin.');

    const code = this.generateCode();
    const ttl = this.config.get<number>('otp.ttlSeconds', 180);
    await this.prisma.otpRequest.create({
      data: { phone, purpose, codeHash: this.hash(code), expiresAt: new Date(Date.now() + ttl * 1000) },
    });
    await this.sms.send(phone, `Bani Group doğrulama kodunuz: ${code}`);
    return code;
  }

  // ============================================================
  // TEK TIP HATA MESAJI — sebep disariya sizmaz.
  // ------------------------------------------------------------
  // Onceden uc ayri mesaj donuyordu: 'Kod bulunamadı veya süresi doldu.',
  // 'Çok fazla deneme.', 'Kod hatalı.'. Ucu de ayni biti ele veriyordu:
  // bir telefon numarasi icin O AN BEKLEYEN bir OTP var mi? Saldirgan
  // uydurma bir kodla verify cagirip yanita bakarak numara tarayabiliyordu
  // ('Kod hatalı.' = kod var, 'Kod bulunamadı...' = kod yok).
  //
  // 'Çok fazla deneme.' de dahil edildi: disarida biraksaydik, alti kez
  // deneyen saldirgan yine "bu numarada bekleyen kod vardi" bilgisini
  // alirdi — tek istekte degil ama yine de.
  //
  // Ayni disiplin transfer-code/consume ucunda zaten uygulaniyor
  // ('Devir kodu gecersiz' — yanlis/kullanilmis/yok icin tek mesaj).
  // ============================================================
  private static readonly GECERSIZ = 'Kod geçersiz veya süresi dolmuş.';

  async verify(phone: string, code: string): Promise<boolean> {
    const maxAttempts = this.config.get<number>('otp.maxAttempts', 5);
    const otp = await this.prisma.otpRequest.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException(OtpService.GECERSIZ);
    if (otp.attempts >= maxAttempts) throw new BadRequestException(OtpService.GECERSIZ);
    if (otp.codeHash !== this.hash(code)) {
      await this.prisma.otpRequest.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException(OtpService.GECERSIZ);
    }
    await this.prisma.otpRequest.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    return true;
  }
}
