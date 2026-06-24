import { IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateProductDto {
  @IsString() @MaxLength(160) name!: string;
  @IsInt() @IsPositive() price!: number; // kurus
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @IsOptional() @IsString() @MaxLength(300) imageUrl?: string;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @IsOptional() @IsNumber() @Min(0) desi?: number; // kargo: hacimsel agirlik
  @IsOptional() @IsNumber() @Min(0) weightKg?: number; // kargo: fiili agirlik (kg)
}
