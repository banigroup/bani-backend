import { IsString, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{9,14}$/)
  phone!: string;

  @IsString()
  @Length(4, 8)
  code!: string;
}
