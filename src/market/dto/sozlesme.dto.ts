import { IsEnum } from 'class-validator';
import { SozlesmeTipi } from '@prisma/client';

// src/load/dto/sozlesme-onayla.dto.ts'in AYNISI ama kopyasi BILEREK ayri:
// "load" check-boundaries'te izole bir birim, "market" ticaret kumesinde;
// market'in ../load/dto/... import etmesi birim siniri ihlalidir. Paylasmak
// isteseydik DTO'nun cekirdege tasinmasi gerekirdi - iki satirlik bir tip icin
// ucuncu bir konum acmak yerine her birim kendi DTO'sunu tutuyor.
//
// Tipin SATICI tarafina ait olup olmadigi burada DEGIL serviste denetlenir
// (MarketService.SATICI_SOZLESMELERI beyaz listesi): enum daralmasi DTO'da
// ifade edilse bile beyaz liste tek yerde kalmali.
export class SaticiSozlesmeOnaylaDto {
  @IsEnum(SozlesmeTipi) sozlesmeTipi!: SozlesmeTipi;
}
