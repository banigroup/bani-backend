import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BusinessUnit, KuyrukDurum, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BildirimService } from '../bildirim/bildirim.service';
import { SigortaService } from '../sigorta/sigorta.service';

// CEKIRDEK IS KUYRUGU (Faz 1): DB tabanli hafif kuyruk.
// ekle() ile is birakilir; dakikalik worker atomik sahiplenir (cift isleme imkansiz),
// hata olursa artan gecikmeyle tekrar dener, maxDeneme sonunda HATA olarak defterde kalir.

// Kilit zaman asimi: bu sureden uzun ISLENIYOR'da kalan is, worker'i kaybetmis sayilir
// (deploy/restart isin ortasinda kesti) ve kuyruga geri alinir.
const KILIT_ZAMAN_ASIMI_DK = 10;

@Injectable()
export class KuyrukService {
  private readonly logger = new Logger(KuyrukService.name);

  // BU SUREC HANGI DIKEYLERIN ISINI ALIR.
  //
  // undefined = HEPSI (bugunku davranis). BANI_KUYRUK_DIKEYLER ortam degiskeni
  // ayarlanmadigi surece filtre HIC UYGULANMAZ; bu paket canli davranisi
  // degistirmez. Ileride worker'i dikey basina cogaltmak gerektiginde
  // (or. BANI_KUYRUK_DIKEYLER=LOAD,SIGORTA) yalnizca env verilir - Railway'de
  // bunun CLI'dan yapilabildigi BANI_PROCESS ile kanitlandi.
  private readonly dikeyler?: BusinessUnit[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly bildirim: BildirimService,
    private readonly sigorta: SigortaService,
  ) {
    this.dikeyler = this.dikeyleriCoz(process.env.BANI_KUYRUK_DIKEYLER);
  }

  /**
   * BANI_KUYRUK_DIKEYLER cozumu. Bos/tanimsiz -> undefined (hepsi islenir).
   *
   * GECERSIZ DEGERDE SESSIZ GECILMEZ: degisken verilmis ama hicbir gecerli
   * dikey cikmiyorsa surec BASLATILMAZ. Sessiz gecilseydi filtre uygulanmaz,
   * "yalniz su dikeyi isle" beklenirken worker HEPSINI islerdi - izolasyon
   * yaniltici bicimde kaybolurdu. Kismen gecersizde (bir degeri yanlis
   * yazilmis) gecerliler kullanilir ama hata loglanir.
   */
  private dikeyleriCoz(ham?: string): BusinessUnit[] | undefined {
    const metin = (ham ?? '').trim();
    if (!metin) return undefined;

    const parcalar = metin.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
    const gecerli = parcalar.filter((p): p is BusinessUnit =>
      (Object.values(BusinessUnit) as string[]).includes(p),
    );
    const gecersiz = parcalar.filter((p) => !(Object.values(BusinessUnit) as string[]).includes(p));

    if (gecersiz.length) {
      this.logger.error(`BANI_KUYRUK_DIKEYLER icinde gecersiz deger: ${gecersiz.join(', ')}`);
    }
    if (!gecerli.length) {
      throw new Error(
        `BANI_KUYRUK_DIKEYLER cozulemedi ("${metin}"). Gecerli degerler: ${Object.values(BusinessUnit).join(', ')}`,
      );
    }
    this.logger.log(`Kuyruk dikey filtresi etkin: ${gecerli.join(', ')}`);
    return gecerli;
  }

  /**
   * Kuyruga is birakir.
   *
   * dikey ZORUNLU ve varsayilani YOK: is_kuyrugu.businessUnit NULL kalirsa,
   * dikey filtreli bir isleyici o isi ASLA almaz (SQL'de NULL IN (...) false)
   * ve is sonsuza kadar BEKLIYOR'da kalir. Zorunlu parametre, yeni bir cagri
   * yerinin dikeyi atlamasini DERLEME HATASINA cevirir.
   *
   * ILKE: dikey = isi ISLERKEN hangi dikeyin servis/DB yukune dokunuluyor
   * (TUKETEN taraf, ureten taraf DEGIL). SIGORTA_LEAD_OLUSTUR'u LOAD dogurur
   * ama isi SigortaService yapar -> SIGORTA.
   */
  async ekle(tip: string, payload: Prisma.InputJsonValue, dikey: BusinessUnit): Promise<void> {
    try {
      await this.prisma.isKuyrugu.create({ data: { tip, payload, businessUnit: dikey } });
    } catch (e) {
      this.logger.error(`Kuyruga eklenemedi: ${tip}`, e as Error);
    }
  }

  // Kilidi dusmus isleri kurtarir: worker isi ISLENIYOR'a cekip surec olurse (Railway deploy,
  // restart, OOM) kayit sonsuza dek ISLENIYOR'da kalirdi ve kimse toplamazdi. Zaman asimini
  // gecenler BEKLIYOR'a geri alinir; deneme sayisi artar ki sonsuz dongu olusmasin.
  private async kilitleriKurtar(): Promise<void> {
    const esik = new Date(Date.now() - KILIT_ZAMAN_ASIMI_DK * 60 * 1000);
    const kurtarilan = await this.prisma.isKuyrugu.updateMany({
      where: {
        durum: KuyrukDurum.ISLENIYOR,
        updatedAt: { lt: esik },
        // Kurtarma da sahiplenme ile AYNI KAPSAMDA: filtreli bir isleyici,
        // baska bir dikeyin isini kurtarmaya kalkmamali - o isin sahibi baska
        // bir surec olabilir ve hala calisiyor olabilir.
        ...(this.dikeyler ? { businessUnit: { in: this.dikeyler } } : {}),
      },
      data: {
        durum: KuyrukDurum.BEKLIYOR,
        denemeSayisi: { increment: 1 },
        sonHata: `Islenirken kesildi (kilit zaman asimi: ${KILIT_ZAMAN_ASIMI_DK} dk)`,
      },
    });
    if (kurtarilan.count > 0) {
      this.logger.warn(`Kilidi dusmus ${kurtarilan.count} is kuyruga geri alindi`);
    }
  }

  // DIS SARMAL: cron'dan disariya hata TASMAZ.
  //
  // Icerideki try/catch yalnizca TEK BIR ISIN calistirilmasini sariyordu;
  // kilitleriKurtar() ve sahiplen() disarida kaliyordu. Deploy penceresinde
  // (eski konteyner baglantiyi kaybederken ya da yenisi Postgres'e erisemeden)
  // dakikalik cron tetiklendiginde Prisma hatasi hicbir yerde yakalanmiyor,
  // Nest scheduler altinda UNHANDLED REJECTION olarak Sentry'ye dusuyordu.
  // Kuyrugun kendini onarmasi bundan etkilenmez: yarida kalan is ISLENIYOR'da
  // kalir, 10 dk sonra kilitleriKurtar onu BEKLIYOR'a geri alir.
  //
  // NOT: burasi DB hatasi disindaki hatalari da yutar. Yutmak "gizlemek" degil -
  // warn olarak log'a dusuyor; amac cron'un surec seviyesinde patlamasini
  // onlemek, cunku is bir sonraki dakikada zaten yeniden denenir.
  @Cron(CronExpression.EVERY_MINUTE)
  async isle(): Promise<void> {
    try {
      await this.isleIc();
    } catch (e: any) {
      this.logger.warn(`Kuyruk turu atlandi: ${e?.message ?? e}`);
    }
  }

  private async isleIc(): Promise<void> {
    await this.kilitleriKurtar();
    for (let i = 0; i < 10; i++) {
      const is = await this.sahiplen();
      if (!is) return;
      try {
        await this.calistir(is.tip, is.payload as any);
        await this.prisma.isKuyrugu.update({ where: { id: is.id }, data: { durum: KuyrukDurum.TAMAM } });
      } catch (e: any) {
        const deneme = is.denemeSayisi + 1;
        const kalici = deneme >= is.maxDeneme;
        const gecikmeDk = Math.pow(2, deneme); // 2, 4, 8 dk
        await this.prisma.isKuyrugu.update({
          where: { id: is.id },
          data: {
            durum: kalici ? KuyrukDurum.HATA : KuyrukDurum.BEKLIYOR,
            denemeSayisi: deneme,
            sonHata: e?.message ?? String(e),
            calistirZamani: new Date(Date.now() + gecikmeDk * 60 * 1000),
          },
        });
        this.logger.error(`Kuyruk isi basarisiz (${deneme}/${is.maxDeneme})${kalici ? ' - KALICI HATA' : ''}: ${is.tip}: ${e?.message ?? e}`);
      }
    }
  }

  // Atomik sahiplenme: BEKLIYOR + zamani gelmis bir isi ISLENIYOR'a ceker; count 1 degilse baskasi almistir.
  // DIKEY FILTRESI BURADA, calistir()'in switch'inde DEGIL. Switch'e konsaydi
  // is once SAHIPLENILIR (ISLENIYOR'a cekilir) sonra reddedilirdi; satir orada
  // asili kalir ve ancak 10 dk sonra kilitleriKurtar onu geri alirdi - her
  // turda ayni is yeniden alinip birakildigi icin kuyruk kendini tikardi.
  // Sahiplenme sorgusunda filtrelemek, isi hic almamayi saglar.
  private async sahiplen() {
    const aday = await this.prisma.isKuyrugu.findFirst({
      where: {
        durum: KuyrukDurum.BEKLIYOR,
        calistirZamani: { lte: new Date() },
        // dikeyler undefined ise kosul HIC EKLENMEZ -> bugunku davranis birebir.
        ...(this.dikeyler ? { businessUnit: { in: this.dikeyler } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!aday) return null;
    const kilit = await this.prisma.isKuyrugu.updateMany({
      where: { id: aday.id, durum: KuyrukDurum.BEKLIYOR },
      data: { durum: KuyrukDurum.ISLENIYOR },
    });
    if (kilit.count !== 1) return null;
    return aday;
  }

  private async calistir(tip: string, payload: Record<string, any>): Promise<void> {
    switch (tip) {
      case 'BILDIRIM_SMS':
        await this.bildirim.gonderSms(payload.alici, payload.sablonKodu, payload.degiskenler ?? {});
        return;
      // BaniLoad -> BaniSigorta lead'i. Payload REFERANS tasir (tasitanId), PII degil:
      // kullanici kuyruk bekleyisi boyunca telefonunu degistirebilir, isleyici
      // calistigi an guncel kaydi okur. ilanId yalnizca izlenebilirlik icin.
      case 'SIGORTA_LEAD_OLUSTUR':
        await this.sigorta.leadOlustur(payload.tasitanId);
        return;
      default:
        throw new Error(`Bilinmeyen kuyruk is tipi: ${tip}`);
    }
  }
}