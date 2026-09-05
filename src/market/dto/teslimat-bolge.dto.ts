import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

/**
 * TEK BOLGE SATIRI. mahalle YOKSA "bu ilcenin tamami" demektir.
 *
 * Iki alanin da GECERLILIGI burada DEGIL serviste kontrol edilir: gecerli
 * degerler kumesi PlatformHizmetBolgesi tablosundan gelir, DTO'ya sabit liste
 * gomulemez (platform kapsami buyudukce degisir).
 */
export class TeslimatBolgeDto {
  @IsString() @MaxLength(80) il!: string;
  @IsString() @MaxLength(80) ilce!: string;

  // BOS DEGIL, YOK: "" gonderilmesi ile alanin hic gonderilmemesi ayni sey
  // degildir; serviste bos metin de "ilcenin tamami" sayilir (trim sonrasi
  // bos -> undefined'a indirgenir).
  @IsOptional() @IsString() @MaxLength(80) mahalle?: string;

  /**
   * BOLGEYE OZEL TESLIMAT UCRETI (kurus). ZORUNLU DEGIL.
   *
   * GONDERILMEZSE bolgenin kendi ucreti yoktur ve siparis mevcut varsayilan
   * kurala duser (15 TL, 300 TL uzeri ucretsiz). 0 GONDERMEK BASKA BIR SEYDIR:
   * "bu bolgeye teslimat ucretsiz" demektir - bu yuzden @Min(0), @IsOptional
   * ile birlikte duruyor ve 0 gecerli bir deger.
   *
   * UST SINIR 1.000.000 kurus (10.000 TL): teslimat ucreti icin ulasilmasi
   * imkansiz bir tavan. Amaci absurt/kotu niyetli degerleri kesmek. BIRIM
   * KARISIKLIGINI (kurus yerine TL girmek) YAKALAMAZ - 15 ile 1500 arasinda
   * hangisinin kasitli oldugu sunucudan anlasilamaz; o ayrim arayuzun isi.
   */
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) feeKurus?: number;
}

/**
 * TUM LISTE TEK ISTEKTE (PUT semantigi) - calisma saatleri ucuyla ayni desen.
 * Kismi ekleme/cikarma YOK: satici panelinde bu form cok secimli bir liste ve
 * "gonderilen = son hal" sozlesmesi hem istemciyi hem audit'i basitlestiriyor.
 *
 * BOS DIZI GECERLIDIR ve "kisit yok" anlamina gelir: magaza her yere teslimat
 * yapar. Satici tum secimleri kaldirabilmeli.
 */
export class TeslimatBolgeleriDto {
  @IsArray()
  @ArrayMaxSize(500) // bir magazanin makul ust siniri; kotu niyetli dev govdeyi de keser
  @ValidateNested({ each: true })
  @Type(() => TeslimatBolgeDto)
  bolgeler!: TeslimatBolgeDto[];
}
