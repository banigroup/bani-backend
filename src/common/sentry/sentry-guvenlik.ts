import * as Sentry from '@sentry/nestjs';
import type { Breadcrumb, Event, NodeOptions } from '@sentry/nestjs';

/**
 * SENTRY VERI GUVENLIGI — 5xx event'lerine kimlik bilgisi ve kisisel veri gitmesin.
 *
 * NEDEN GEREKLI (10.69.0'da kurulu paket kodunda dogrulandi):
 *   · Gelen istek govdesi sendDefaultPii'DEN BAGIMSIZ yakalaniyor (varsayilan
 *     "medium", 10 KB) ve her event'e request.data olarak ekleniyor. OTP
 *     dogrulamada govde = telefon + kod; refresh'te = refresh token.
 *   · Event yolunda header/cookie filtresi yok: Authorization ve Cookie oldugu
 *     gibi gidiyordu.
 *   · console.* satirlari breadcrumb olarak event'e ekleniyor (Nest Logger
 *     stdout'a yazdigi icin girmiyor).
 *
 * GOVDE STRATEJISI — YAKALAMA TAMAMEN KAPALI (A), ALAN TEMIZLEME (B) DEGIL:
 * govdeler uca gore degisiyor (OTP, token, vergi no, IBAN...). Alan adi listesiyle
 * temizlemek her yeni ucta unutulabilir bir liste demek; yakalamamak ise yapisal.
 * Teshis icin URL, metot, hassas olmayan header'lar ve stack yeterli.
 * beforeSend'deki request.data silme ikinci kat: govde baska bir yoldan
 * gelse bile gitmez.
 */

const HASSAS_HEADER = /authorization|cookie|token|secret|api-?key/i;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const UZUN_HEX = /\b[a-f0-9]{32,}\b/gi;
// Harf/tire bitisigi olan diziler (UUID parcalari) disarida birakilir.
const TELEFON = /(?<![\w-])\+?\d[\d ]{8,18}\d(?![\w-])/g;
const KISA_KOD = /(?<![\w-])\d{4,8}(?![\w-])/g;

export function metinTemizle(metin: string, kodlariDaGizle = false): string {
  let s = metin.replace(JWT, '[jwt]').replace(UZUN_HEX, '[token]').replace(TELEFON, '[telefon]');
  if (kodlariDaGizle) s = s.replace(KISA_KOD, '[kod]');
  return s;
}

function istekTemizle<T extends Event>(event: T): T {
  const istek = event.request;
  if (istek) {
    delete istek.data;
    delete istek.cookies;
    if (istek.headers) {
      for (const ad of Object.keys(istek.headers)) {
        if (HASSAS_HEADER.test(ad)) delete istek.headers[ad];
      }
    }
  }
  return event;
}

// console breadcrumb'inda ham argumanlar da `data.arguments` icinde tasiniyor;
// yalnizca mesaji temizlemek yetmez.
export function kirintiTemizle(kirinti: Breadcrumb): Breadcrumb {
  if (kirinti.category !== 'console') return kirinti;
  const { arguments: _ham, ...kalanData } = kirinti.data ?? {};
  return {
    ...kirinti,
    message: kirinti.message ? metinTemizle(kirinti.message, true) : kirinti.message,
    data: kalanData,
  };
}

export function eventTemizle<T extends Event>(event: T): T {
  istekTemizle(event);
  if (event.message) event.message = metinTemizle(event.message);
  for (const istisna of event.exception?.values ?? []) {
    if (istisna.value) istisna.value = metinTemizle(istisna.value);
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(kirintiTemizle);
  return event;
}

export function sentrySecenekleri(): NodeOptions {
  return {
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    // Ayni adli entegrasyon varsayilanin YERINE gecer (core filterDuplicates).
    integrations: [Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' })],
    beforeBreadcrumb: (kirinti) => kirintiTemizle(kirinti),
    beforeSend: (event) => eventTemizle(event),
    beforeSendTransaction: (event) => eventTemizle(event),
  };
}
