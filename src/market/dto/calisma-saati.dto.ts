import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsInt, IsOptional,
  Matches, Max, Min, ValidateNested,
} from 'class-validator';

/** "HH:MM", 24 saat. Saniye YOK: sema Time(0), dakika cozunurlugu yeterli. */
const SAAT = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * TEK ARALIK. Gece yarisini asan mesai GECERLIDIR (20:00-02:00): acikMi bunu
 * zaten destekliyor, DTO'da reddetmek ozelligi oldururdu. Yasak olan tek sey
 * openTime === closeTime (bkz. serviste dogrulama).
 */
export class AralikDto {
  @Matches(SAAT, { message: 'openTime "HH:MM" biçiminde olmalı' })
  openTime!: string;

  @Matches(SAAT, { message: 'closeTime "HH:MM" biçiminde olmalı' })
  closeTime!: string;
}

/**
 * BIR GUN. Kapaliysa araliklar BOS dizi; aciksa en az bir aralik.
 * Ogle arasi = iki aralik (09:00-13:00 + 14:00-19:00).
 */
export class GunSaatiDto {
  @IsInt() @Min(0) @Max(6)
  weekday!: number; // 0=Pazar ... 6=Cumartesi (JS getDay ile ayni)

  @IsBoolean()
  isClosed!: boolean;

  @IsArray() @ValidateNested({ each: true }) @Type(() => AralikDto)
  araliklar!: AralikDto[];
}

/**
 * HAFTANIN TAMAMI TEK ISTEKTE. Kismi guncelleme YOK: eksik gun "kayit yok =
 * acik" anlamina gelirdi ve kullanicinin kasti belirsiz kalirdi. Yazma tek
 * transaction'da atomik.
 */
export class CalismaSaatleriDto {
  @IsArray() @ArrayMinSize(7) @ArrayMaxSize(7)
  @ValidateNested({ each: true }) @Type(() => GunSaatiDto)
  gunler!: GunSaatiDto[];

  /**
   * SEZONLUK TAKVIM: verilmezse BUGUN. Sema effectiveFrom/effectiveUntil ile
   * surumlemeyi destekliyor; acikMi en yeni gecerli surumu seciyor. Gecmis
   * tarih reddedilir (serviste) - geriye donuk takvim sessiz surprizler uretir.
   */
  @IsOptional() @IsDateString()
  effectiveFrom?: string;
}
