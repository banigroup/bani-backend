import { IsString, IsOptional, IsObject, ValidateNested, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class FirmaProfilDto {
  @IsString() @IsNotEmpty() unvan!: string;
  @IsString() @IsNotEmpty() vergiDairesi!: string;
  @IsString() @IsNotEmpty() vkn!: string;
  @IsString() @IsNotEmpty() yetkiliAd!: string;
  @IsString() @IsNotEmpty() yetkiliSoyad!: string;
  @IsString() @IsNotEmpty() email!: string;
  @IsString() @IsNotEmpty() adres!: string;
}

export class TasiyiciProfilDto {
  @IsString() @IsNotEmpty() ad!: string;
  @IsString() @IsNotEmpty() soyad!: string;
  @IsString() @IsNotEmpty() tcKimlik!: string;
  @IsString() @IsNotEmpty() email!: string;
  @IsString() @IsNotEmpty() plaka!: string;
  @IsString() @IsNotEmpty() ehliyetNo!: string;
  @IsString() @IsNotEmpty() srcNo!: string;
  @IsString() @IsNotEmpty() kBelgeNo!: string;
}

export class LoadProfilKaydetDto {
  @IsOptional() @IsObject() @ValidateNested() @Type(() => FirmaProfilDto)
  firma?: FirmaProfilDto;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => TasiyiciProfilDto)
  tasiyici?: TasiyiciProfilDto;
}