import { ArgumentMetadata, BadRequestException, Injectable, ParseUUIDPipe, PipeTransform } from '@nestjs/common';

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

/**
 * OPSIYONEL SORGU PARAMETRESI ICIN UUID DOGRULAMASI.
 *
 * Yol parametresi ya vardir ya rota eslesmez; SORGU parametresi ise
 * OLMAYABILIR. UuidParam'i dogrudan bir @Query'ye takmak, parametreyi
 * gondermeyeni de 400'e dusururdu.
 *
 * ParseUUIDPipe'in `optional: true` SECENEGI TEK BASINA YETMIYOR: kaynak
 * koddaki kosul `isNil(value)`, yani yalnizca undefined/null'i atlar. BOS
 * STRING nil DEGILDIR - `?categoryId=` gonderen bir istemci (ornegin "tum
 * kategoriler" secili bir acilir liste) bugun sorunsuz calisirken 400 almaya
 * baslardi. Bugunku davranis: bos string falsy oldugu icin filtre hic
 * uygulanmiyor (catalog.service.listProducts). Bu sarmalayici o davranisi
 * AYNEN korur: bos string "hic gonderilmemis" sayilir.
 *
 * Dogrulama isini UuidParam'a devrediyor - ikinci bir UUID kurali/mesaji
 * uretilmiyor. Dizi gelirse (`?categoryId=a&categoryId=b`) ParseUUIDPipe'in
 * isString kontrolu devreye girer ve yine 400 doner, 500 DEGIL.
 */
@Injectable()
class OpsiyonelUuidPipe implements PipeTransform<unknown, Promise<string | undefined>> {
  async transform(value: unknown, metadata: ArgumentMetadata): Promise<string | undefined> {
    if (value === undefined || value === null || value === '') return undefined;
    return UuidParam.transform(value as string, metadata);
  }
}

/** UuidParam'in opsiyonel kardesi; @Query icin. Durumsuz, tek ornek paylasilir. */
export const UuidQuery = new OpsiyonelUuidPipe();
