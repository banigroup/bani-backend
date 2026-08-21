import './instrument';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

// API ile ayni: BigInt'in JSON'a serilesebilmesi. Worker HTTP dondurmuyor ama
// log/Sentry payload'larinda BigInt gecebiliyor.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

/**
 * createApplicationContext (create DEGIL): HTTP sunucusu ACILMAZ. Worker'in
 * dinledigi bir port yok; yalnizca zamanlayici calisir. Railway'de bu surecin
 * healthcheck'i de yoktur - ayakta olup olmadigi log ve is ciktisiyla anlasilir.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log('Worker up — cron isleri bu surecte calisiyor (API surecinde DEGIL)', 'WorkerBootstrap');
}
bootstrap();
