import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class AracTeklifVerDto {
  @IsString()
  aracIlaniId!: string;

  @IsInt()
  @Min(1)
  fiyatKurus!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  mesaj?: string;
}
