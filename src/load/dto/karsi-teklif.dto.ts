import { IsInt, Min } from 'class-validator';

export class KarsiTeklifDto {
  @IsInt()
  @Min(1)
  yeniFiyatKurus!: number;
}
