import { IsInt, IsPositive, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class TransferDto {
  @IsUUID() toUserId!: string;
  @IsInt() @IsPositive() amount!: number; // kuruş
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
}
