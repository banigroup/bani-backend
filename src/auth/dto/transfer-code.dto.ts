import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class TransferCodeUretDto {
  // Kodun gecerli olacagi hedef origin (or. https://www.banikervan.com.tr).
  // require_tld kapali degil: yalnizca gercek markali domainler beklenir,
  // ama yerel gelistirmede localhost da kullanilabilsin diye require_tld false.
  @IsString() @MaxLength(200) @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  hedefOrigin!: string;
}

export class TransferCodeTuketDto {
  @IsString() @MaxLength(200) kod!: string;

  // Hedef domainde ZATEN bir oturum varsa onun access token'i. Sepet cakismasi
  // kontrolu icin kullanilir. Opsiyoneldir: canlidaki istemci su an yalnizca
  // { kod } gonderiyor, o yuzden zorunlu yapilamaz.
  @IsOptional() @IsString() @MaxLength(2000) mevcutToken?: string;
}
