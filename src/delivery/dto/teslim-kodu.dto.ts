import { IsString, Matches } from 'class-validator';

// Kurye teslimat aninda musterinin okudugu 6 haneli kodu girer.
// Bicim burada kesilir; dogrulama (esitlik, tek kullanim, deneme siniri)
// DeliveryService.deliver icindedir.
export class TeslimKoduDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Teslim kodu 6 haneli olmalı' })
  teslimKod!: string;
}
