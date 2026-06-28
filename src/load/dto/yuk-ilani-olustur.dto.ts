import { IsString, IsInt, IsOptional, IsEnum, IsDateString, Min } from 'class-validator';
import { AracTipi } from '@prisma/client';

export class YukIlaniOlusturDto {
  @IsString() nereden!: string;
  @IsString() nereye!: string;
  @IsString() yukTipi!: string;
  @IsInt() @Min(1) tonajKg!: number;
  @IsOptional() @IsEnum(AracTipi) aracTipiIhtiyaci?: AracTipi;
  @IsDateString() yuklemeTarihi!: string;
  @IsOptional() @IsString() aciklama?: string;
  @IsOptional() @IsInt() @Min(0) butceKurus?: number;
}
