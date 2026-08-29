import { PartialType } from '@nestjs/mapped-types';
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
export class UpdateProductDto extends PartialType(CreateProductDto) {}
