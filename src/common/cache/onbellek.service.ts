import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import type { Redis, Cluster } from 'ioredis';

/**
 * ONBELLEK TEMIZLIGI — CacheInterceptor'in yazdigi anahtarlari yazma
 * uclarindan silmek icin.
 *
 * NEDEN DESEN (PATTERN) SILME: CacheInterceptor anahtari ISTEK URL'INDEN
 * uretiyor, sorgu dizesi DAHIL. Yani tek bir magazanin urun listesi icin
 * onlarca anahtar olusabiliyor:
 *   /api/v1/catalog/stores/<id>/products
 *   /api/v1/catalog/stores/<id>/products?take=100
 *   /api/v1/catalog/stores/<id>/products?categoryId=...&skip=100
 * Urun guncellendiginde bunlarin HEPSI bayatliyor; tek anahtar silmek yetmez.
 * Bu yuzden ioredis istemcisine inip SCAN ile desene uyan anahtarlar siliniyor.
 *
 * SCAN, KEYS DEGIL: KEYS tum anahtar uzayini tek seferde tarar ve Redis'i
 * bloklar. SCAN parca parca ilerler; onbellek temizligi bir yazma isteginin
 * icinde calistigi icin bloklamamasi onemli.
 *
 * HATA YUTULUR: onbellek temizligi ASIL ISI (urun/magaza yazmasi) basarisiz
 * kilmamali - kayit zaten yazildi. Temizlik yapilamazsa en fazla TTL kadar
 * (30-60 sn) bayat veri gorunur; istegi 500'e cevirmek bundan cok daha kotu
 * olurdu. AuditService'in ayni gerekcesi.
 */
@Injectable()
export class OnbellekService {
  private readonly logger = new Logger(OnbellekService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  /**
   * Bir magazanin KATALOG anahtarlarinin tamami: urun listeleri VE kategori
   * listesi. Tek desende birlestirildi cunku kategori listesi urun durumuna
   * BAGLI - listCategories bos kategorileri gizliyor ve _count'u stok>0 olan
   * urunlerden sayiyor. Yani her urun yazmasi ikisini birden bayatlatiyor;
   * ayri iki SCAN yerine tek SCAN yapmak hem daha ucuz hem de "birini
   * temizleyip digerini unutma" hatasini yapisal olarak imkansiz kiliyor.
   *
   * Desen magaza kapsamli (`catalog/stores/<id>/*`): bu on ek altinda
   * onbellege alinan BASKA bir uc yok (yalnizca products ve categories).
   */
  async magazaKataloguTemizle(storeId: string): Promise<number> {
    return this.desenSil(`*catalog/stores/${storeId}/*`);
  }

  /**
   * TUM magazalarin urun listeleri. Satici durumu degisiminde kullanilir:
   * listProducts "satici ACTIVE" suzuyor, yani bir saticinin askiya alinmasi
   * o saticinin TUM magazalarinin urun listelerini bayatlatiyor. Magaza
   * id'lerini ayrica sorgulamak yerine desenle silmek daha ucuz - islem nadir
   * (admin karari) ve onbellek zaten TTL'li.
   */
  async tumUrunListeleriniTemizle(): Promise<number> {
    return this.desenSil('*catalog/stores/*/products*');
  }

  /**
   * Vitrin magaza listesi. Magaza olusturma/guncelleme ve SATICI DURUMU
   * degisiminde bayatliyor: listActive "isActive + satici ACTIVE" suzuyor.
   */
  async magazaListesiniTemizle(): Promise<number> {
    return this.desenSil('*market/stores*');
  }

  /**
   * Desene uyan anahtarlari siler. Redis istemcisine ulasilamazsa (or. yerelde
   * bellek store'una dusuldugu bir kurulum) sessizce 0 doner - cagiran taraf
   * icin davranis ayni: temizlik "en iyi caba".
   */
  private async desenSil(desen: string): Promise<number> {
    const istemci = this.redisIstemcisi();
    if (!istemci) return 0;
    try {
      let silinen = 0;
      let imlec = '0';
      do {
        const [yeniImlec, anahtarlar] = await istemci.scan(imlec, 'MATCH', desen, 'COUNT', 200);
        imlec = yeniImlec;
        if (anahtarlar.length > 0) {
          await istemci.del(...anahtarlar);
          silinen += anahtarlar.length;
        }
      } while (imlec !== '0');
      if (silinen > 0) this.logger.log(`Onbellek temizlendi: ${desen} -> ${silinen} anahtar`);
      return silinen;
    } catch (e) {
      this.logger.warn(`Onbellek temizligi atlandi (${desen}): ${(e as Error).message}`);
      return 0;
    }
  }

  /** cache-manager store'unun altindaki ioredis istemcisi (varsa). */
  private redisIstemcisi(): Redis | Cluster | null {
    const store = (this.cache as unknown as { store?: { client?: Redis | Cluster } }).store;
    return store?.client ?? null;
  }
}
