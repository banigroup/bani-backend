// F3 — SENTRY EVENT GUVENLIGI, GERCEK NEST + GERCEK SENTRY SDK ILE.
//
// Uygulamayla AYNI secenekler (sentrySecenekleri) ve AYNI global filtre
// (SentryGlobalFilter) kullanilir; yalnizca DSN sahte ve transport kayit
// yapan no-op'tur - AG TRAFIGI YOK, hicbir sey Sentry'ye gitmez.
//
// IKI KATMAN AYRI DOGRULANIR: beforeSend'e GIREN event (govde yakalama kapali
// mi) ve TRANSPORT'A GIDEN envelope (temizlik yapildi mi). Girenin Authorization
// tasidigini gormek testin bos yere gecmedigini de kanitlar.
//
// NEDEN ENVELOPE, beforeSend CIKTISI DEGIL: beforeSend'den cikan nesnede
// sdkProcessingMetadata.normalizedRequest ham header'lari hala tasiyor; SDK bu
// alani gonderimden hemen once siliyor (@sentry/core envelope.js:44). Ag'a
// giden gercek yuk envelope oldugu icin iddialar orada kurulur.
import 'reflect-metadata';
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  INestApplication,
  Module,
  Post,
} from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';
import type { ErrorEvent, EventHint } from '@sentry/nestjs';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { eventTemizle, kirintiTemizle, metinTemizle, sentrySecenekleri } from './sentry-guvenlik';

const OTP_SENTINEL_482913 = '482913';
const PHONE_SENTINEL_905550001122 = '+905550001122';
const AUTH_SENTINEL_TOKEN = 'AUTH_SENTINEL_TOKEN';
const COOKIE_SENTINEL_SECRET = 'COOKIE_SENTINEL_SECRET';
const REFRESH_SENTINEL_SECRET = 'REFRESH_SENTINEL_SECRET';
const SENTINELLER = [OTP_SENTINEL_482913, '905550001122', AUTH_SENTINEL_TOKEN, COOKIE_SENTINEL_SECRET, REFRESH_SENTINEL_SECRET];

@Controller('auth')
class SahteAuthController {
  @Post('otp/verify')
  @HttpCode(200)
  verify(@Body() govde: { phone: string; code: string }) {
    // Console entegrasyonunun urettigi kirintinin BIREBIR bicimi (core
    // integrations/console.js). Gercek console.log KULLANILMADI: Jest kendi
    // console nesnesini enjekte ettigi icin Sentry'nin console yamasi test
    // icinde tetiklenmiyor (Jest disi probe'da tetiklendigi goruldu). Kirinti
    // yine gercek istemcinin beforeBreadcrumb kancasindan gecer.
    const satir = `otp dogrulama basladi tel=${govde.phone} kod=${govde.code}`;
    Sentry.addBreadcrumb({ category: 'console', level: 'log', message: satir, data: { arguments: [satir], logger: 'console' } });
    throw new Error(`beklenmeyen veritabani hatasi (phone=${govde.phone})`);
  }

  @Post('otp/verify-400')
  @HttpCode(200)
  verify400() {
    throw new BadRequestException('Kod geçersiz veya süresi dolmuş.');
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() _govde: { refreshToken: string }) {
    throw new Error('refresh sirasinda beklenmeyen hata');
  }
}

@Module({
  imports: [SentryModule.forRoot()],
  controllers: [SahteAuthController],
  providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
})
class SahteModul {}

describe('F3 — Sentry 5xx event temizligi', () => {
  let app: INestApplication;
  let taban = '';
  let girenler: ErrorEvent[] = [];
  let cikanlar: ErrorEvent[] = [];

  beforeAll(async () => {
    const secenekler = sentrySecenekleri();
    Sentry.init({
      ...secenekler,
      dsn: 'https://public@o0.ingest.invalid/0',
      transport: () => ({
        send: async (envelope: any) => {
          for (const [baslik, yuk] of envelope[1]) {
            if (baslik.type === 'event') cikanlar.push(JSON.parse(JSON.stringify(yuk)));
          }
          return {};
        },
        flush: async () => true,
      }),
      beforeSend: (event: ErrorEvent, hint: EventHint) => {
        girenler.push(JSON.parse(JSON.stringify(event)));
        return (secenekler.beforeSend as any)(event, hint);
      },
    });
    app = await NestFactory.create(SahteModul, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    taban = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  });

  afterAll(async () => {
    await app?.close();
    await Sentry.close(2000);
  });

  beforeEach(() => {
    girenler = [];
    cikanlar = [];
  });

  async function gonder(yol: string, govde: object) {
    const yanit = await fetch(`${taban}${yol}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'bani-test-agent',
        authorization: `Bearer ${AUTH_SENTINEL_TOKEN}`,
        cookie: `sid=${COOKIE_SENTINEL_SECRET}; refresh=${REFRESH_SENTINEL_SECRET}`,
      },
      body: JSON.stringify(govde),
    });
    await Sentry.flush(2000);
    return yanit;
  }

  it('5-10. simule 500 /auth/otp/verify -> kod, telefon, Authorization, cookie yok; teshis verisi korunuyor', async () => {
    const yanit = await gonder('/auth/otp/verify', { phone: PHONE_SENTINEL_905550001122, code: OTP_SENTINEL_482913 });
    expect(yanit.status).toBe(500);
    expect(cikanlar).toHaveLength(1);
    expect(cikanlar[0].sdkProcessingMetadata).toBeUndefined();

    // Katman A: govde beforeSend'e HIC gelmiyor; harness header'i gercekten yakaliyor.
    expect(girenler[0].request?.data).toBeUndefined();
    expect(girenler[0].request?.headers?.authorization).toContain(AUTH_SENTINEL_TOKEN);
    // beforeBreadcrumb kirintiyi EKLENIRKEN temizliyor (beforeSend'den once).
    expect(JSON.stringify(girenler[0].breadcrumbs)).toContain('[kod]');
    expect(JSON.stringify(girenler[0].breadcrumbs)).not.toContain(OTP_SENTINEL_482913);

    const ev = cikanlar[0];
    const ham = JSON.stringify(ev);
    for (const s of SENTINELLER) expect(ham).not.toContain(s); // 5, 6, 7, 8
    expect(ev.request?.data).toBeUndefined();
    expect(ev.request?.cookies).toBeUndefined();
    expect(ev.request?.headers?.authorization).toBeUndefined();
    expect(ev.request?.headers?.cookie).toBeUndefined();

    // 10. teshis icin gereken hassas olmayan veri duruyor
    expect(ev.request?.url).toContain('/api/v1/auth/otp/verify');
    expect(ev.request?.method).toBe('POST');
    expect(ev.request?.headers?.['user-agent']).toBe('bani-test-agent');
    expect(ev.request?.headers?.['content-type']).toBe('application/json');
    expect(ev.exception?.values?.[0]?.value).toBe('beklenmeyen veritabani hatasi (phone=[telefon])');
    expect(ev.exception?.values?.[0]?.stacktrace?.frames?.length).toBeGreaterThan(0);
    const kirinti = (ev.breadcrumbs ?? []).find((b) => b.category === 'console');
    expect(kirinti?.message).toBe('otp dogrulama basladi tel=[telefon] kod=[kod]');
    expect(kirinti?.data).toEqual({ logger: 'console' });
  });

  it('9. simule 500 /auth/refresh -> refreshToken event icinde yok', async () => {
    const yanit = await gonder('/auth/refresh', { refreshToken: REFRESH_SENTINEL_SECRET });
    expect(yanit.status).toBe(500);
    expect(cikanlar).toHaveLength(1);
    const ham = JSON.stringify(cikanlar[0]);
    for (const s of SENTINELLER) expect(ham).not.toContain(s);
  });

  it('11. beklenen 400 auth hatasi -> Sentry event yok, yanit degismedi', async () => {
    const yanit = await gonder('/auth/otp/verify-400', { phone: PHONE_SENTINEL_905550001122, code: OTP_SENTINEL_482913 });
    expect(yanit.status).toBe(400);
    expect((await yanit.json()).message).toBe('Kod geçersiz veya süresi dolmuş.');
    expect(girenler).toHaveLength(0);
  });
});

describe('F3 — temizleyici birim davranisi', () => {
  it('govde baska yoldan gelse bile silinir; hassas header adlari genis yakalanir', () => {
    const ev = eventTemizle({
      request: {
        data: { code: OTP_SENTINEL_482913 },
        cookies: { sid: COOKIE_SENTINEL_SECRET },
        headers: {
          Authorization: 'x',
          'set-cookie': 'x',
          'x-api-key': 'x',
          'x-refresh-token': 'x',
          'x-bani-dikey': 'market',
        },
      },
    } as any);
    expect(ev.request).toEqual({ headers: { 'x-bani-dikey': 'market' } });
  });

  it('UUID, HTTP durum kodu ve kisa sayilar hata mesajinda bozulmaz', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(metinTemizle(`Kayit ${uuid} bulunamadi, HTTP 500, port 4000`)).toBe(
      `Kayit ${uuid} bulunamadi, HTTP 500, port 4000`,
    );
    expect(metinTemizle('tel +90 555 000 11 22')).toBe('tel [telefon]');
    expect(metinTemizle('Bearer eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl')).toBe('Bearer [jwt]');
    expect(metinTemizle('refresh ' + 'ab12'.repeat(24))).toBe('refresh [token]');
  });

  it('console disi breadcrumb dokunulmadan gecer', () => {
    const k = { category: 'http', data: { url: 'https://api.iletimerkezi.com/v1/send-sms/json' } };
    expect(kirintiTemizle(k)).toBe(k);
  });

  it('sentrySecenekleri govde yakalamayi kapatan Http entegrasyonunu iceriyor', () => {
    const ent = sentrySecenekleri().integrations as Array<{ name: string }>;
    expect(ent.map((e) => e.name)).toEqual(['Http']);
  });
});
