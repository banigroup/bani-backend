import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('sentry-test')
  sentryTest() {
    throw new Error('Sentry test hatasi - kurulum dogrulama');
  }

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: true, ts: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ status: 'down', db: false });
    }
  }
}