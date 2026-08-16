import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SigortaDurum, SubeBasvuruDurum } from '@prisma/client';

// Panel: YENI -> ARANDI -> TAMAMLANDI. Iki enum ayni degerleri tasir ama
// Prisma'da ayri tipler oldugu icin DTO da ayri.
export class SigortaTalepDurumDto {
  @IsEnum(SigortaDurum) durum!: SigortaDurum;
  @IsOptional() @IsString() @MaxLength(500) adminNot?: string;
}

export class SubeBasvuruDurumDto {
  @IsEnum(SubeBasvuruDurum) durum!: SubeBasvuruDurum;
  @IsOptional() @IsString() @MaxLength(500) adminNot?: string;
}
