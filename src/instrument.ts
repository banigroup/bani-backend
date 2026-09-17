import * as Sentry from "@sentry/nestjs";
import { sentrySecenekleri } from "./common/sentry/sentry-guvenlik";

// Govde yakalama kapali + auth header/cookie/PII temizligi: bkz. sentry-guvenlik.ts
Sentry.init(sentrySecenekleri());
