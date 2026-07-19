import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? 'https://1ce2f72ce418b37d35567dd14a7377e0@o4511760851730432.ingest.de.sentry.io/4511760865034320',
  environment: process.env.RAILWAY_ENVIRONMENT_NAME ? 'production' : 'local',
  tracesSampleRate: 0,
});