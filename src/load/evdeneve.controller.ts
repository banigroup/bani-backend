import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/rbac/roles.guard';
import { Roles } from '../common/rbac/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../common/audit/audit.service';
import { EvdenEveService } from './evdeneve.service';
import { EvIlaniOlusturDto } from './dto/ev-ilani-olustur.dto';
import { EvTeklifVerDto } from './dto/ev-teklif-ver.dto';
import { KesfeDavetDto } from './dto/kesfe-davet.dto';
import { KesifSonucDto } from './dto/kesif-sonuc.dto';

@Controller('load/ev')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CARRIER, Role.LOAD_CUSTOMER, Role.CUSTOMER, Role.ADMIN, Role.SUPER_ADMIN)
export class EvdenEveController {
  constructor(private readonly ev: EvdenEveService, private readonly audit: AuditService) { }

  @Post('ilan')
  async ilanOlustur(@CurrentUser() user: AuthUser, @Body() dto: EvIlaniOlusturDto, @Req() req: Request) {
    const r = await this.ev.ilanOlustur(user, dto);
    await this.audit.record({ actorId: user.id, action: 'load.ev.ilan', entity: 'EvIlani', entityId: (r as any)?.id ?? null, ip: req.ip });
    return r;
  }

  @Get('ilanlarim')
  ilanlarim(@CurrentUser() user: AuthUser) {
    return this.ev.ilanlarim(user);
  }

  @Get('borsa')
  borsa() {
    return this.ev.borsa();
  }

  @Get('admin/bekleyenler')
  bekleyenler(@CurrentUser() user: AuthUser) {
    return this.ev.bekleyenIlanlar(user);
  }

  @Patch('ilan/:id/ucret-onay')
  async ucretOnay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const r = await this.ev.ucretOnayla(user, id);
    await this.audit.record({ actorId: user.id, action: 'load.ev.ucretOnay', entity: 'EvIlani', entityId: id });
    return r;
  }

  @Post('teklif')
  async teklifVer(@CurrentUser() user: AuthUser, @Body() dto: EvTeklifVerDto, @Req() req: Request) {
    const r = await this.ev.onTeklifVer(user, dto);
    await this.audit.record({ actorId: user.id, action: 'load.ev.onTeklif', entity: 'EvTeklif', entityId: (r as any)?.id ?? null, ip: req.ip });
    return r;
  }

  @Patch('teklif/kesfe-davet')
  async kesfeDavet(@CurrentUser() user: AuthUser, @Body() dto: KesfeDavetDto, @Req() req: Request) {
    const r = await this.ev.kesfeDavet(user, dto.teklifId, dto.kesifRandevu);
    await this.audit.record({ actorId: user.id, action: 'load.ev.kesfeDavet', entity: 'EvTeklif', entityId: dto.teklifId, ip: req.ip });
    return r;
  }

  @Patch('teklif/kesif-sonuc')
  async kesifSonuc(@CurrentUser() user: AuthUser, @Body() dto: KesifSonucDto, @Req() req: Request) {
    const r = await this.ev.kesifSonuc(user, dto);
    await this.audit.record({ actorId: user.id, action: 'load.ev.kesifSonuc', entity: 'EvTeklif', entityId: dto.teklifId, ip: req.ip });
    return r;
  }

  @Get('ilan/:id')
  ilanDetay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.ev.ilanDetay(user, id);
  }
}