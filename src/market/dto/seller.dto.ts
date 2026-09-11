import { IsDateString, IsEmail, IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { BusinessUnit, SellerStatus, SellerType } from '@prisma/client';

/**
 * SATICI BASVURUSU ACMA (S2). Isletme temel bilgileri gonderildiginde
 * Seller(DRAFT) yaratilir - owner karari D4.
 *
 * GOVDEDE OLMAYAN, BILEREK: ownerUserId (JWT'den alinir - istemci baskasi
 * adina basvuru acamaz), status ve verification (sema varsayilanlari DRAFT /
 * EKSIK; istemcinin kendi basvurusunu ACTIVE ilan etmesi imkansiz olmali),
 * roles ve isActive (bu ucun isi degil). ValidationPipe zaten
 * forbidNonWhitelisted ile calisiyor (main.ts), yani bu alanlar gonderilirse
 * istek 400 doner - ek bir kontrol gerekmiyor.
 *
 * basvuruEposta NORMALIZE EDILMEZ BURADA: repoda @Transform emsali YOK
 * (arama sonucu bos), yeni bir DTO davranis deseni icat etmemek icin
 * trim+lowercase servis katmaninda yapiliyor.
 */
export class CreateSaticiDto {
  @IsString() @MinLength(2) @MaxLength(120) yetkiliAdSoyad!: string;

  // @IsEmail bicimi dogrular; uzunluk siniri ayri cunku gecerli ama asiri uzun
  // bir adres kolonu sisirir. UNIQUE DEGIL (owner karari OD-4): bu bir iletisim
  // alani, kimlik degil - danisman/grup sirketi ayni adresi paylasabilir.
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girin' })
  @MaxLength(160)
  basvuruEposta!: string;

  @IsString() @MinLength(2) @MaxLength(200) legalName!: string;
  @IsString() @MinLength(2) @MaxLength(200) displayName!: string;

  @IsEnum(SellerType) sellerType!: SellerType;

  // ILK BASVURUDA TEK DIKEY (owner karari OD-1). @IsEnum yalnizca BusinessUnit
  // uyeligini dogrular; hangi dikeylerin SATICIYA acik oldugu ayri bir kural ve
  // serviste (SATICI_DIKEYLERI) uygulaniyor - PLATFORM/COURIER/SIGORTA/DICLEFUL
  // gecerli enum degerleridir ama satici basvurusu dikeyi DEGILDIR.
  @IsEnum(BusinessUnit) talepEdilenDikey!: BusinessUnit;

  // OPSIYONEL (owner karari OD-5): mevcut kural vergi kimligini SUBMIT sarti
  // sayiyor (saticiOnayaGonder), kayit acma sarti degil. O kural degistirilmedi.
  // Bicim SaticiGuncelleDto ile birebir ayni tutuldu - iki ucun ayni alani
  // farkli kabul etmesi kullaniciya aciklanamaz.
  @IsOptional() @Matches(/^\d{10,11}$/, { message: 'Vergi kimliği 10 (VKN) ya da 11 (TCKN) hane olmalı' })
  taxIdentifier?: string;
}

export class SaticiGuncelleDto {
  @IsOptional() @IsEnum(SellerType) sellerType?: SellerType;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) legalName?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) displayName?: string;
  // VKN 10, TCKN 11 hane. Duz metin YALNIZCA bu istekte gorunur; kolona
  // AES-256-GCM ile sifrelenip yazilir (bkz. common/crypto/gizli-alan.ts).
  @IsOptional() @Matches(/^\d{10,11}$/, { message: 'Vergi kimliği 10 (VKN) ya da 11 (TCKN) hane olmalı' })
  taxIdentifier?: string;
}

export class SaticiDurumDto {
  @IsEnum(SellerStatus) status!: SellerStatus;
}

export class SaticiDogrulamaDto {
  @IsIn(['ONAYLANDI', 'REDDEDILDI']) sonuc!: 'ONAYLANDI' | 'REDDEDILDI';
  // Onayda bitis tarihi verilir; tarih gecince kayit SURESI_DOLDU'ya duser.
  @IsOptional() @IsDateString() verificationExpiresAt?: string;
}

// Belge reddi. Gerekce ZORUNLU DEGIL ama verilirse saticiya gorunur
// (satici_belgeleri.redGerekce) - "neden reddedildi" sorusunun tek cevabi budur.
export class BelgeReddetDto {
  @IsOptional() @IsString() @MaxLength(500) gerekce?: string;
}
