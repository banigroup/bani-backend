import { Body, Controller, Get, Patch, Post, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { DeliveryService } from './delivery.service';
import { AraciKurumDto } from './dto/araci-kurum.dto';

@Controller('delivery')
@UseGuards(JwtAuthGuard)
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) { }

  @Get('available')
  available(@CurrentUser() user: AuthUser) {
    return this.delivery.available(user);
  }

  @Get('cargo')
  cargo(@CurrentUser() user: AuthUser) {
    return this.delivery.cargoQueue(user);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.delivery.mine(user, status);
  }

  @Post(':id/claim')
  claim(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.delivery.claim(user, id);
  }

  @Post(':id/pickup')
  pickup(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.delivery.pickup(user, id);
  }

  @Post(':id/deliver')
  deliver(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.delivery.deliver(user, id);
  }

  // Aracı kuruma devret (admin/süper admin) — admin panelinden çağrılır.
  // Rol kontrolü servis içinde (aracikurumaVer).
  @Patch(':id/aracikurum')
  aracikurum(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AraciKurumDto) {
    return this.delivery.aracikurumaVer(user, id, dto.kargoFirmasi, dto.takipNo);
  }
}
