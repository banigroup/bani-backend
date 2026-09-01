import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { BusinessUnit, OrderStatus } from '@prisma/client';

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

  /**
   * DIKEY SUZGECI — OPSIYONEL. Verilmezse mevcut davranis birebir korunur
   * (saticinin TUM magazalari). Verilirse magaza kumesi o dikeye daralir ve
   * TOPLAMLAR DA ayni kumeye gore hesaplanir - filtre where'de yasadigi icin
   * aggregate/groupBy/findMany ucu de ayni daralmayi gorur.
   *
   * ISTEMCININ BILDIRDIGI DEGERE GUVENILIYOR ama yetki genisletmiyor: dikey
   * yalnizca DARALTIR. Magaza kumesi zaten kullanicinin kendi satici
   * kaydindan turetiliyor, yani bu parametreyle baskasinin verisine
   * ulasilamaz. (bkz. common/domain/dikey-domain.ts'teki "istemci basligina
   * guvenme" uyarisi - orada dikey sepeti YAZIYORDU, burada yalnizca okumayi
   * suzuyor.)
   */
  @IsOptional() @IsIn(Object.keys(BusinessUnit)) dikey?: BusinessUnit;

  // Sayfalama LISTE icindir; TOPLAMLAR bundan etkilenmez (aggregate ayri kosar).
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) skip?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
}
