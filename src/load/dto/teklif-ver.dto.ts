import { IsString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class TeklifVerDto {
  @IsUUID() yukIlaniId!: string;
  @IsInt() @Min(1) fiyatKurus!: number;
  @IsOptional() @IsString() mesaj?: string;
  @IsOptional() @IsString() plaka?: string;
  @IsOptional() @IsString() surucuAdi?: string;
  @IsOptional() @IsString() surucuTel?: string;
}
