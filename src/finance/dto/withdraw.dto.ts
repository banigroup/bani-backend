import { IsInt, IsPositive, IsOptional, IsString, MaxLength } from 'class-validator';

export class WithdrawDto {
  @IsInt() @IsPositive() amount!: number; // kuruş
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
}
