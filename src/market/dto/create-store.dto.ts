import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { StoreType } from '@prisma/client';

export class CreateStoreDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsEnum(StoreType) type?: StoreType;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(300) logoUrl?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) district?: string;
  @IsOptional() @IsString() @MaxLength(200) line1?: string;
  @IsOptional() @IsInt() @Min(0) minOrder?: number;
}
