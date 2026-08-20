import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min } from 'class-validator';

// VARYANT — boy/porsiyon/renk.
//
// FIYAT ALANLARI CARSI'DA FARKLI ISLER: Carsi magazasinda kargo+komisyon+KDV
// urun fiyatina GOMULU oldugu icin satici NET fiyati verir, vitrin fiyati ve
// muhasebe kirilimi vitrinFiyatHesapla ile URETILIR (urun tarafindaki desenin
// aynisi). Carsi disinda price dogrudan satis fiyatidir.
export class VaryantOlusturDto {
  @IsString() @MaxLength(120) name!: string;
  // Carsi disi: satis fiyati. Carsi: verilirse net fiyat sayilir (netFiyat yoksa).
  @IsOptional() @IsInt() @IsPositive() price?: number;
  // null birakilirsa urunun fiyati/stogu gecerli olur (etkinFiyat/etkinStok).
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @IsOptional() @IsString() @MaxLength(60) barcode?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;

  // --- Carsi fiyat girdileri (urun DTO'suyla ayni adlar) ---
  @IsOptional() @IsInt() @Min(0) netFiyat?: number;
  @IsOptional() @IsNumber() @Min(0) desi?: number;
  @IsOptional() @IsNumber() @Min(0) weightKg?: number;
  @IsOptional() @IsIn([0, 1, 10, 20]) kdvOrani?: number;
  @IsOptional() @IsIn(['A', 'B']) satisModeli?: string;
}

export class VaryantGuncelleDto extends VaryantOlusturDto {
  @IsOptional() @IsString() @MaxLength(120) declare name: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// --- SECENEK GRUBU (magaza duzeyinde, birden cok urune baglanir) ---
export class SecenekGrubuDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsInt() @Min(0) minSecim?: number;
  @IsOptional() @IsInt() @Min(0) maxSecim?: number;
  @IsOptional() @IsBoolean() zorunlu?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SecenekDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsInt() @Min(0) ekUcret?: number; // kurus
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// Urun <-> secenek grubu eslesmesi TOPLU yazilir: gonderilen liste nihai
// durumdur (eksikler kaldirilir). Kismi guncellemede istemcinin iki cagriyla
// tutarsiz durum birakma ihtimali ortadan kalkar.
export class UrunSecenekGruplariDto {
  @IsOptional() @IsUUID('4', { each: true }) optionGroupIds?: string[];
}

// --- MEDYA ---
export class MedyaEkleDto {
  @IsString() @MaxLength(500) url!: string;
  @IsOptional() @IsIn(['GORSEL', 'VIDEO', 'BELGE']) tur?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class MedyaGuncelleDto {
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}
