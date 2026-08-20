import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class AddItemDto {
  @IsUUID() productId!: string;
  // Varyant OPSIYONEL: gonderilmezse urunun kendisi sepete girer (varyantsiz
  // urunlerde bugunku davranis). Varyantin o urune ait ve aktif oldugu
  // cart.service icinde dogrulanir.
  @IsOptional() @IsUUID() variantId?: string;
  // SECIMLER OPSIYONEL: gonderilmezse secimsiz kalem (bugunku davranis).
  // Seceneklerin urunun gruplarina ait ve aktif oldugu, grup min/max ve zorunlu
  // sinirlarinin saglandigi cart.service icinde dogrulanir - DTO burada yalnizca
  // bicim ve ust sinir bakar (100: menu grubu bu buyuklukte olmaz, kotu niyetli
  // devasa listeyi sorgu acilmadan keser).
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('4', { each: true }) optionIds?: string[];
  @IsOptional() @IsInt() @Min(1) @Max(999) quantity?: number;
}
