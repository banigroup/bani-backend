import { Module, Logger } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { OtpService } from "./otp/otp.service";
import { TokenService } from "./tokens/token.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { SMS_PROVIDER } from "./otp/sms/sms-provider.interface";
import { ConsoleSmsProvider } from "./otp/sms/console-sms.provider";
import { IletiMerkeziSmsProvider } from "./otp/sms/iletimerkezi-sms.provider";
const smsAktif = process.env.SMS_AKTIF === "true";
new Logger("AuthModule").log(`SMS provider: ${smsAktif ? "ILETI MERKEZI" : "CONSOLE"} | SMS_AKTIF=[${process.env.SMS_AKTIF}] | SENDER=[${process.env.ILETIMERKEZI_SENDER}] | KEY_VAR=[${!!process.env.ILETIMERKEZI_KEY}]`);
@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    JwtStrategy,
    {
      provide: SMS_PROVIDER,
      useClass: process.env.SMS_AKTIF === "true" ? IletiMerkeziSmsProvider : ConsoleSmsProvider,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
