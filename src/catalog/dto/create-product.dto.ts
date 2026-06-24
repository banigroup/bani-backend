import { IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateProductDto {
  @IsString() @MaxLength(160) name!: string;
  @IsInt() @IsPositive() price!: number; // kurus (net yoksa bu net sayilir)
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsString() @MaxLength(60) sku?: string;
  @IsOptional() @IsString() @MaxLength(300) imageUrl?: string;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @IsOptional() @IsNumber() @Min(0) desi?: number;
  @IsOptional() @IsNumber() @Min(0) weightKg?: number;
  @IsOptional() @IsInt() @Min(0) netFiyat?: number; // saticinin net fiyati (kurus)
  @IsOptional() @IsIn([1, 10, 20]) kdvOrani?: number;
  @IsOptional() @IsIn(['A', 'B']) satisModeli?: string;
}
