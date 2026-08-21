import { IsString, MaxLength } from 'class-validator';

export class RolAtaDto {
  // Role enum'inin DEGERI ('STORE_CASHIER'). Hangi rollerin atanabilecegi
  // serviste ATANABILIR_MAGAZA_ROLLERI ile dogrulanir - @IsEnum(Role) burada
  // KULLANILMADI cunku o, ADMIN/SUPER_ADMIN dahil TUM Role degerlerini gecerli
  // sayardi ve asil kisit "atanabilir olanlar" cok daha dar.
  @IsString() @MaxLength(40) role!: string;
}
