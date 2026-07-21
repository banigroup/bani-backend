import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class KesifSonucDto {
  @IsUUID() teklifId!: string;
  @IsBoolean() beyanUygun!: boolean; // true: on teklif gecerli, false: revize
  @IsOptional() @IsInt() @Min(1) kesinFiyatKurus?: number; // beyanUygun=false ise zorunlu
  @IsArray() @ArrayMinSize(1) kesifFotograflar!: string[]; // tasiyanin kamera-zorunlu cekimleri (iki tarafli delil)
  @IsOptional() @IsString() @MaxLength(1000) kesifNotu?: string;
}