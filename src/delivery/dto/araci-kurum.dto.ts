import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { KargoFirmasi } from '@prisma/client';

export class AraciKurumDto {
  @IsEnum(KargoFirmasi) kargoFirmasi!: KargoFirmasi;
  @IsString() @MinLength(3) @MaxLength(60) takipNo!: string;
}
