import { IsInt, IsPositive, IsOptional, IsString, MaxLength } from 'class-validator';

export class TopupDto {
  @IsInt() @IsPositive() amount!: number; // kuruş (minor units)
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
}
