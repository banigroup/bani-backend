import { IsString, IsOptional, IsBoolean, MinLength } from 'class-validator';

export class SigortaSubeBasvuruDto {
  @IsString() @MinLength(2) adSoyad!: string;
  @IsString() @MinLength(7) telefon!: string;
  @IsOptional() @IsString() ilBolge?: string;
  @IsOptional() @IsBoolean() sektorTecrube?: boolean;
  @IsOptional() @IsBoolean() segemSertifika?: boolean;
  @IsOptional() @IsString() aciklama?: string;
}
