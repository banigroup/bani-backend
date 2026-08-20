import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class AddItemDto {
  @IsUUID() productId!: string;
  // Varyant OPSIYONEL: gonderilmezse urunun kendisi sepete girer (varyantsiz
  // urunlerde bugunku davranis). Varyantin o urune ait ve aktif oldugu
  // cart.service icinde dogrulanir.
  @IsOptional() @IsUUID() variantId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(999) quantity?: number;
}
