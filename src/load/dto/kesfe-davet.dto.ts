import { IsDateString, IsUUID } from 'class-validator';

export class KesfeDavetDto {
  @IsUUID() teklifId!: string;
  @IsDateString() kesifRandevu!: string; // kesif randevu zamani
}