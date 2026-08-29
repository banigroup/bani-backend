import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';

/**
 * YOL PARAMETRESI UUID DOGRULAMASI — tek ortak ornek.
 *
 * NEDEN VAR: `@Param('id') id: string` hicbir dogrulamadan gecmiyordu ve deger
 * dogrudan Prisma'ya UUID kolonu kosulu olarak gidiyordu. Gecersiz formatli bir
 * id (or. `<id>` gibi doldurulmamis bir sablon) Prisma katmaninda
 * PrismaClientKnownRequestError ("Inconsistent column data: Error creating UUID")
 * firlatiyor, bu da istemciye 500 olarak donuyor ve Sentry'de GERCEK HATA gibi
 * gorunuyordu. Oysa bu bir istemci hatasidir: dogru cevap 400.
 *
 * GLOBAL ValidationPipe BU ISI YAPMIYOR (main.ts): metatype String oldugu icin
 * dogrulamayi atliyor - yalnizca sinif tipli (DTO) girdileri dogruluyor.
 *
 * SURUM SARTI KONULMADI (`version` verilmedi): amac gecerli istekleri OLDUGU
 * GIBI birakip yalnizca "hic UUID olmayan" degerleri kesmek. Surum 4 sarti
 * konsaydi, ileride farkli surumde uretilmis ya da elle girilmis bir kimlik
 * bugun calisan bir istegi 400'e dusurebilirdi - davranis degisikligi
 * gecersiz id ile SINIRLI kalmali.
 *
 * TEK ORNEK PAYLASILIYOR: ParseUUIDPipe durumsuzdur (yalnizca secenekleri
 * tutar), her cagri yerinde yeni ornek uretmenin karsiligi yok.
 */
export const UuidParam = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException('Geçersiz kimlik biçimi (UUID bekleniyor)'),
});
