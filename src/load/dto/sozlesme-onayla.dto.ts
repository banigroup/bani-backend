import { IsEnum } from 'class-validator';
import { SozlesmeTipi } from '@prisma/client';

export class SozlesmeOnaylaDto {
  @IsEnum(SozlesmeTipi) sozlesmeTipi!: SozlesmeTipi;
}
