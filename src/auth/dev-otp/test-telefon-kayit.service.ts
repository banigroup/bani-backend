import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { TEST_TELEFON_TTL_SANIYE, testTelefonAnahtari } from './test-telefon-anahtar';

/**
 * GECICI TEST TELEFONU KAYIT DEFTERI.
 *
 * TEK ISI: "production'da bu numara devCode almaya yetkili, gecici bir BANİ
 * test numarasi mi?" sorusuna cevap vermek. OTP motorunun bir parcasi DEGIL -
 * kodun uretimi, hash'i, suresi, deneme sayaci ve dogrulamasi Postgres'te ve
 * bu servisten tamamen bagimsiz.
 *
 * NEDEN REDIS: kayit GECICI bir yetki, kalici bir is verisi degil. Sema
 * degisikligi gerektirmiyor, TTL'i Redis'in kendisi uyguluyor ve owner'in test
 * penceresi kapaninca kayit kendiliginden dusuyor. MEVCUT baglanti kullaniliyor
 * (AppModule'deki global CacheModule); ikinci bir Redis istemcisi ACILMADI.
 *
 * KAPALI BASARISIZ: Redis okunamazsa kayitliMi() FALSE doner, yani devCode
 * gosterilmez. Yanlis tarafa dusmek "herkese kod goster" demek olurdu.
 */
@Injectable()
export class TestTelefonKayit {
  private readonly logger = new Logger(TestTelefonKayit.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  /** Numarayi verilen sure boyunca test kapsamina alir. Hata YUTULMAZ: cagiran (CLI) bilmeli. */
  async kaydet(telefon: string, ttlSaniye: number = TEST_TELEFON_TTL_SANIYE): Promise<void> {
    // cache-manager v5 TTL'i MILISANIYE bekliyor (AppModule'deki 30_000 ile ayni birim).
    await this.cache.set(testTelefonAnahtari(telefon), 1, ttlSaniye * 1000);
  }

  /**
   * Kayitli mi? Hata halinde FALSE (kapali basarisiz).
   *
   * Hata YUKARI ITILMEZ: bu kontrol /auth/otp/request icinde calisiyor ve Redis
   * coktugunde OTP istegi 500 olmamali - kod yine uretilir, SMS yine gider,
   * yalnizca devCode yanita EKLENMEZ.
   */
  async kayitliMi(telefon: string): Promise<boolean> {
    try {
      const deger = await this.cache.get<number>(testTelefonAnahtari(telefon));
      return deger !== undefined && deger !== null;
    } catch (e) {
      this.logger.warn(`Test telefonu kaydi okunamadi, devCode kapali: ${(e as Error).message}`);
      return false;
    }
  }

  /** Test yetkisini suresi dolmadan kaldirir. */
  async sil(telefon: string): Promise<void> {
    await this.cache.del(testTelefonAnahtari(telefon));
  }
}
