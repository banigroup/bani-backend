import { Body, Controller, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { NewsletterService } from './newsletter.service';
import { SubscribeDto } from './dto/subscribe.dto';

@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletter: NewsletterService) {}

  // Yeni kayit -> 201, mukerrer kayit -> 200 (hata verilmez).
  // Durum kodu sonuca gore degistigi icin @HttpCode yerine Res kullanilir.
  @Public()
  @Post('subscribe')
  async subscribe(@Body() dto: SubscribeDto, @Res({ passthrough: true }) res: Response) {
    const sonuc = await this.newsletter.subscribe(dto);
    res.status(sonuc.yeni ? HttpStatus.CREATED : HttpStatus.OK);
    return sonuc;
  }
}
