import { IsInt, Min, Max } from 'class-validator';

export class UpdateItemDto {
  @IsInt() @Min(0) @Max(999) quantity!: number; // 0 = kaldır
}
