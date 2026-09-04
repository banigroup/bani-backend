import { PartialType } from '@nestjs/mapped-types';
import { IsInt, IsOptional, Min } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

/**
 * isActive BILEREK YOK.
 *
 * Alan burada dururken satici, PATCH /catalog/products/:id govdesine
 * isActive:true yazarak kendi urununu yayina alabiliyordu: bu ucun kapisi
 * PRODUCT_WRITE + assertOwner, ikisi de saticida var. updateProduct dto'yu
 * { ...dto } ile dogrudan prisma.product.update'e gecirdigi icin alan
 * hicbir kontrole ugramadan yaziliyor ve dort kapi birden atlaniyordu:
 * PRODUCT_APPROVE izni, assertPlatformYoneticisi, magazayaBagliMi
 * (kendi urununu onaylama yasagi) ve assertSaticiAktif (BR-001).
 *
 * Yayina alma yolu TEK: PATCH /catalog/products/:id/approve — reddetme icin
 * /reject. Ikisi de PRODUCT_APPROVE ister (yalnizca ADMIN + SUPER_ADMIN).
 *
 * Global ValidationPipe whitelist + forbidNonWhitelisted acik oldugu icin
 * (src/main.ts) alan kaldirilinca istek sessizce yok sayilmaz, 400 doner.
 */
export class UpdateProductDto extends PartialType(CreateProductDto) {
  /**
   * STOK YAZIMI ICIN IYIMSER KILIT — istemcinin gordugu stok degeri.
   *
   * NEDEN: siparis hatti stogu GORELI dusuruyor (stock: { decrement: q }),
   * panel ise MUTLAK yaziyor. Satici formu acip rafi sayarken araya bir siparis
   * girerse, mutlak yazma o siparisin dusumunu SESSIZCE eziyor ve satilan mal
   * stoga geri donuyordu (fazla satis). Beklenen deger gonderildiginde yazma
   * "stok hala bu mu" kosuluyla yapilir; degismisse 409 doner.
   *
   * OPSIYONEL - GERIYE DONUK UYUM: alani gondermeyen istemcide sunucu kendi
   * okudugu guncel degeri taban alir (bkz. catalog.service updateProduct).
   * Bu, istegin KENDI penceresini korur ama formun acik kaldigi sureyi
   * KORUMAZ; gercek koruma icin istemci bu alani gondermelidir.
   *
   * YALNIZ stock GONDERILDIGINDE ANLAMLI; tek basina gonderilmesi bir sey
   * yazmaz.
   */
  @IsOptional() @IsInt() @Min(0) expectedStock?: number;
}
