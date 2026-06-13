import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp/otp.service';
import { TokenService } from './tokens/token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SMS_PROVIDER } from './otp/sms/sms-provider.interface';
import { ConsoleSmsProvider } from './otp/sms/console-sms.provider';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    JwtStrategy,
    { provide: SMS_PROVIDER, useClass: ConsoleSmsProvider },
  ],
  exports: [AuthService],
})
export class AuthModule {}
