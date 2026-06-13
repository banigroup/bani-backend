import { IsString, Matches } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{9,14}$/, { message: 'Telefon E.164 formatında olmalı' })
  phone!: string;
}
