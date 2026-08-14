import { IsString, IsOptional, IsNotEmpty } from "class-validator";

export class CreateBasvuruDto {
  @IsString() @IsNotEmpty()
  adSoyad!: string;

  @IsString() @IsNotEmpty()
  telefon!: string;

  @IsString() @IsOptional()
  il?: string;

  // Tipe ozel (opsiyonel) alanlar
  @IsString() @IsOptional()
  isletme?: string;   // SELLER

  @IsString() @IsOptional()
  restoran?: string;  // RESTAURANT

  @IsString() @IsOptional()
  butce?: string;     // FRANCHISE

  @IsString() @IsOptional()
  aracTipi?: string;  // COURIER

  // DICLEFUL teklif formu. Hepsi opsiyonel: diger 5 tip bu alanlari gondermez.
  // @IsEmail KULLANILMADI - bozuk yazilmis bir adres yuzunden teklif talebinin
  // tamamen reddedilmesi, adresi hatali kaydetmekten daha kotu (lead kaybi).
  @IsString() @IsOptional()
  email?: string;     // DICLEFUL

  @IsString() @IsOptional()
  aylikAdet?: string; // DICLEFUL: serbest metin ("500-1000" gibi girilebiliyor)

  @IsString() @IsOptional()
  mesaj?: string;     // DICLEFUL
}
