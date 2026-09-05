import './instrument';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import compression from 'compression';

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Railway proxy arkasinda gercek istemci IP'si icin sart (rate limit + audit):
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.enableCors({ origin: true, credentials: true });

  // Yanit sikistirma (gzip). Vitrin/katalog listeleri JSON olarak buyuyor;
  // sikistirma bant genisligini ve mobilde algilanan sureyi dusurur.
  // enableCors'tan SONRA, listen'dan ONCE: mevcut sira (prefix -> pipe -> cors)
  // bilincli, araya girilmedi.
  app.use(compression());

  const port = config.get<number>('api.port', 4000);
  await app.listen(port);
  Logger.log(`API up on http://localhost:${port}/api/v1`, 'Bootstrap');
}
bootstrap();

