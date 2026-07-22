import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class DonusVerDto {
  @IsString() @MaxLength(40) neredenIl!: string;
  @IsString() @MaxLength(40) nereyeIl!: string;
  @IsDateString() tarihBas!: string;
  @IsDateString() tarihBit!: string;
  @IsOptional() @IsString() @MaxLength(60) aracTipi?: string;
  @IsOptional() @IsString() @MaxLength(500) aciklama?: string;
}

export class DonusDavetDto {
  @IsUUID() evIlaniId!: string;
}