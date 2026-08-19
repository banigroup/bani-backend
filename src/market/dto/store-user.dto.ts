import { IsBoolean, IsUUID } from 'class-validator';

// Magazaya personel ekleme: eklenecek kullanicinin kimligi.
// Kisinin YETKISI rolunden gelir; uyelik yalnizca o yetkinin bu magazada
// kullanilabilmesini saglar (bkz. schema.prisma StoreUser).
export class PersonelEkleDto {
  @IsUUID() userId!: string;
}

// Isten ayrilan personel SILINMEZ, kapatilir: gecmis audit kayitlari
// "bu kisi o sirada uyeydi" baglamini korumali.
export class PersonelDurumDto {
  @IsBoolean() isActive!: boolean;
}
