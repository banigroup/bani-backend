import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus } from '@prisma/client';

/**
 * Satici toplu siparis sorgusu.
 *
 * ZAMAN DILIMI BILEREK ISTEMCIDE: from/to MUTLAK an (ISO-8601) olarak gelir,
 * sunucu yalnizca placedAt uzerinden filtreler. Sunucu UTC, Turkiye UTC+3;
 * "bugun"u burada hesaplasaydik gun siniri 3 saat kayardi. Gunun nerede
 * basladigini bilen taraf istemcidir, karari o verir.
 */
export class SaticiSiparisSorguDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;

  // Enum'un TAMAMI kabul edilir; beyaz liste yok - satici kendi siparisinin
  // her durumunu gorebilmeli (iptal/iade dahil).
  @IsOptional() @IsIn(Object.keys(OrderStatus)) status?: OrderStatus;

  // Sayfalama LISTE icindir; TOPLAMLAR bundan etkilenmez (aggregate ayri kosar).
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
}
