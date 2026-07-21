import { IsInt, IsUUID, Min } from 'class-validator';

export class EvTeklifVerDto {
  @IsUUID() evIlaniId!: string;
  @IsInt() @Min(1) onTeklifKurus!: number; // fotografa gore on teklif (baglayici degil)
}