import { IsString, IsInt, IsEnum, IsDateString, Min, IsOptional } from 'class-validator';
import { AracTipi } from '@prisma/client';
export class AracIlaniOlusturDto {
  @IsEnum(AracTipi) aracTipi!: AracTipi;
  @IsString() nereden!: string;
  @IsString() nereye!: string;
  @IsDateString() cikisTarihi!: string;
  @IsInt() @Min(1) kapasiteKg!: number;
  @IsOptional() @IsInt() @Min(1) beklenenFiyatKurus?: number;
  @IsOptional() @IsString() plaka?: string;
  @IsOptional() @IsString() aciklama?: string;
}