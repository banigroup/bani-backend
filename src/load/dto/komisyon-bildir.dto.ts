import { IsInt, IsOptional, IsString, IsEnum, Min } from 'class-validator';
import { KomisyonOdemeYontem } from '@prisma/client';

export class KomisyonBildirDto {
  @IsInt() @Min(1) tutarKurus!: number;
  @IsOptional() @IsEnum(KomisyonOdemeYontem) yontem?: KomisyonOdemeYontem;
  @IsOptional() @IsString() dekont?: string;
}
