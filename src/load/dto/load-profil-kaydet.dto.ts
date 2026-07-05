import { IsString, IsOptional, IsObject, ValidateNested, IsNotEmpty, Length, Matches, IsEmail, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class FirmaProfilDto {
  @IsString() @MinLength(3, { message: 'Firma ünvanı en az 3 karakter olmalı' })
  unvan!: string;

  @IsString() @MinLength(3, { message: 'Vergi dairesi en az 3 karakter olmalı' })
  vergiDairesi!: string;

  @IsString() @Matches(/^[0-9]{10}$/, { message: 'VKN 10 haneli rakam olmalı' })
  vkn!: string;

  @IsString() @MinLength(3, { message: 'Yetkili adı en az 3 karakter olmalı' })
  yetkiliAd!: string;

  @IsString() @MinLength(3, { message: 'Yetkili soyadı en az 3 karakter olmalı' })
  yetkiliSoyad!: string;

  @IsEmail({}, { message: 'Geçerli bir e-posta girin' })
  email!: string;

  @IsString() @MinLength(10, { message: 'Adres en az 10 karakter olmalı' })
  adres!: string;
}

export class TasiyiciProfilDto {
  @IsString() @MinLength(3, { message: 'Ad en az 3 karakter olmalı' })
  ad!: string;

  @IsString() @MinLength(3, { message: 'Soyad en az 3 karakter olmalı' })
  soyad!: string;

  @IsString() @Matches(/^[0-9]{11}$/, { message: 'TC Kimlik No 11 haneli rakam olmalı' })
  tcKimlik!: string;

  @IsOptional() @IsString()
  email?: string;

  @IsString() @MinLength(4, { message: 'Plaka en az 4 karakter olmalı' })
  plaka!: string;

  @IsString() @MinLength(3, { message: 'Ehliyet no en az 3 karakter olmalı' })
  ehliyetNo!: string;

  @IsString() @MinLength(3, { message: 'SRC no en az 3 karakter olmalı' })
  srcNo!: string;

  @IsString() @MinLength(3, { message: 'K belge no en az 3 karakter olmalı' })
  kBelgeNo!: string;
}

export class LoadProfilKaydetDto {
  @IsOptional() @IsObject() @ValidateNested() @Type(() => FirmaProfilDto)
  firma?: FirmaProfilDto;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => TasiyiciProfilDto)
  tasiyici?: TasiyiciProfilDto;
}