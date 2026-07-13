import { IsString, IsEnum, IsOptional, MinLength } from 'class-validator';
import { SigortaTuru, SigortaKaynak } from '@prisma/client';
export class SigortaTalepDto {
  @IsString() @MinLength(2) adSoyad!: string;
  @IsString() @MinLength(7) telefon!: string;
  @IsEnum(SigortaTuru) sigortaTuru!: SigortaTuru;
  @IsOptional() @IsEnum(SigortaKaynak) kaynak?: SigortaKaynak;
}
