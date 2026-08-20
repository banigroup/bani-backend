import { IsDateString, IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { SellerStatus, SellerType } from '@prisma/client';

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
