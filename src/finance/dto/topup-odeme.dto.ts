import { IsInt, IsPositive, IsOptional, IsString, MaxLength, IsObject, Max } from 'class-validator';

// Odeme saglayici uzerinden bakiye yukleme (iki adimli akis).
// DIKKAT: bu DTO'da referans alani YOKTUR. Ledger reference'i saglayicidan gelir;
// istemcinin referans gondermesi idempotency anahtarini ele gecirmesi demekti.
export class TopupBaslatDto {
  // Ust sinir: tek seferde 50.000 TL. Eski topup ucunda hic sinir yoktu.
  @IsInt() @IsPositive() @Max(5_000_000) tutarKurus!: number;
  @IsOptional() @IsString() @MaxLength(200) aciklama?: string;
}

export class TopupDogrulaDto {
  @IsString() @MaxLength(120) saglayiciRef!: string;
  @IsOptional() @IsObject() saglayiciYaniti?: Record<string, unknown>;
}
