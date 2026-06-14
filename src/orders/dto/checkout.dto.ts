import { IsOptional, IsUUID, IsString, MaxLength } from 'class-validator';

export class CheckoutDto {
  @IsOptional() @IsUUID() addressId?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
