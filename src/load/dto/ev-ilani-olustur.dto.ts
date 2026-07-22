import { IsArray, ArrayMinSize, IsBoolean, IsDateString, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class EvIlaniOlusturDto {
  @IsString() @MaxLength(10) evTipi!: string; // 1+1 ... 4+2
  @IsString() @MaxLength(40) neredenIl!: string;
  @IsOptional() @IsString() @MaxLength(60) neredenIlce?: string;
  @IsOptional() @IsInt() @Min(0) neredenKat?: number;
  @IsOptional() @IsBoolean() neredenAsansor?: boolean;
  @IsString() @MaxLength(40) nereyeIl!: string;
  @IsOptional() @IsString() @MaxLength(60) nereyeIlce?: string;
  @IsOptional() @IsInt() @Min(0) nereyeKat?: number;
  @IsOptional() @IsBoolean() nereyeAsansor?: boolean;
  @IsDateString() alimTarihi!: string;
  @IsOptional() @IsDateString() teslimBaslangic?: string; // tasiyan belirler - tasitan gondermez
  @IsOptional() @IsDateString() teslimBitis?: string;
  @IsArray() @ArrayMinSize(1) fotograflar!: string[]; // kamera-zorunlu cekim URL'leri (frontend capture)
  @IsOptional() @IsString() @MaxLength(1000) aciklama?: string;
  @IsOptional() @IsBoolean() sigortaTalebi?: boolean;
}