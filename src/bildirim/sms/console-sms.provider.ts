import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SMS');
  async send(phone: string, message: string): Promise<void> {
    this.logger.warn(`[DEV SMS] -> ${phone}: ${message}`);
  }
}
