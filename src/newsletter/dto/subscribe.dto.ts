import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class SubscribeDto {
  @IsEmail({}, { message: 'Gecerli bir e-posta adresi girin' })
  @MaxLength(190)
  eposta!: string;

  // Enum degil: CARSI / MARKET / LOAD / GENEL ... Verilmezse GENEL.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  businessUnit?: string;
}
