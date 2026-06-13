import { IsBoolean, IsEnum, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength } from 'class-validator';
import { AddressType } from '@prisma/client';

export class CreateAddressDto {
  @IsOptional() @IsEnum(AddressType) type?: AddressType;
  @IsOptional() @IsString() @MaxLength(60) title?: string;
  @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MaxLength(2) country?: string;
  @IsString() @MaxLength(80) city!: string;
  @IsOptional() @IsString() @MaxLength(80) district?: string;
  @IsOptional() @IsString() @MaxLength(80) neighborhood?: string;
  @IsString() @MaxLength(200) line1!: string;
  @IsOptional() @IsString() @MaxLength(200) line2?: string;
  @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
