import { IsString, MaxLength } from 'class-validator';

export class VerIzinDto {
  // Permission enum'inin DEGERI ('store:write'). Tanimli olup olmadigi serviste
  // tabloya bakilarak dogrulanir - enum'a yeni deger eklenip migration
  // yazilmadiysa burada acik hata verir.
  @IsString() @MaxLength(80) permission!: string;
}
