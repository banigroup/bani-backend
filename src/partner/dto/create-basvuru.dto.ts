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
}
