import { Controller, Post, Get, Patch, Param, Body, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/rbac/roles.guard';
import { Roles } from '../common/rbac/roles.decorator';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../common/audit/audit.service';
import { Role } from '@prisma/client';
import { SigortaService } from './sigorta.service';
import { SigortaTalepDto } from './dto/sigorta-talep.dto';
import { SigortaSubeBasvuruDto } from './dto/sigorta-sube-basvuru.dto';
import { SigortaTalepDurumDto, SubeBasvuruDurumDto } from './dto/durum-guncelle.dto';
@Controller('sigorta')
export class SigortaController {
  constructor(private readonly sigorta: SigortaService, private readonly audit: AuditService) {}
  @Public()
  @Post('talep')
  talepOlustur(@Body() dto: SigortaTalepDto) {
    return this.sigorta.talepOlustur(dto);
  }
  @Get('talepler')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  talepleriListele() {
    return this.sigorta.talepleriListele();
  }

  @Patch('talepler/:id/durum')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async talepDurumGuncelle(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SigortaTalepDurumDto, @Req() req: Request) {
    const r = await this.sigorta.talepDurumGuncelle(id, dto.durum, dto.adminNot);
    await this.audit.record({ actorId: user.id, action: 'sigorta.talep.durum', entity: 'SigortaTalep', entityId: id, ip: req.ip, metadata: { durum: dto.durum } });
    return r;
  }

  @Public()
  @Post('sube-basvuru')
  subeBasvuruOlustur(@Body() dto: SigortaSubeBasvuruDto) {
    return this.sigorta.subeBasvuruOlustur(dto);
  }

  @Get('sube-basvurular')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  subeBasvurulariListele() {
    return this.sigorta.subeBasvurulariListele();
  }

  @Patch('sube-basvurular/:id/durum')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  async subeBasvuruDurumGuncelle(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SubeBasvuruDurumDto, @Req() req: Request) {
    const r = await this.sigorta.subeBasvuruDurumGuncelle(id, dto.durum, dto.adminNot);
    await this.audit.record({ actorId: user.id, action: 'sigorta.subeBasvuru.durum', entity: 'SigortaSubeBasvuru', entityId: id, ip: req.ip, metadata: { durum: dto.durum } });
    return r;
  }
}
