import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/rbac/roles.guard';
import { Roles } from '../common/rbac/roles.decorator';
import { Role } from '@prisma/client';
import { SigortaService } from './sigorta.service';
import { SigortaTalepDto } from './dto/sigorta-talep.dto';
@Controller('sigorta')
export class SigortaController {
  constructor(private readonly sigorta: SigortaService) {}
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
}
