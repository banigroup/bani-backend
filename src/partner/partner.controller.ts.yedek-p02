import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { PartnerService } from "./partner.service";
import { CreateBasvuruDto } from "./dto/create-basvuru.dto";
import { PartnerBasvuruTip, PartnerBasvuruDurum } from "@prisma/client";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../common/rbac/permissions.guard";
import { RequirePermissions } from "../common/rbac/permissions.decorator";
import { Permission } from "../common/rbac/permissions.enum";

@Controller("partner-applications")
export class PartnerController {
  constructor(private readonly partner: PartnerService) {}

  @Post("seller")
  seller(@Body() dto: CreateBasvuruDto, @Req() req: Request) {
    return this.partner.basvuruOlustur(PartnerBasvuruTip.SELLER, dto, req.ip, req.headers["user-agent"]);
  }

  @Post("franchise")
  franchise(@Body() dto: CreateBasvuruDto, @Req() req: Request) {
    return this.partner.basvuruOlustur(PartnerBasvuruTip.FRANCHISE, dto, req.ip, req.headers["user-agent"]);
  }

  @Post("restaurant")
  restaurant(@Body() dto: CreateBasvuruDto, @Req() req: Request) {
    return this.partner.basvuruOlustur(PartnerBasvuruTip.RESTAURANT, dto, req.ip, req.headers["user-agent"]);
  }

  @Post("courier")
  courier(@Body() dto: CreateBasvuruDto, @Req() req: Request) {
    return this.partner.basvuruOlustur(PartnerBasvuruTip.COURIER, dto, req.ip, req.headers["user-agent"]);
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_MANAGE_ALL)
  listele(@Query("tip") tip?: PartnerBasvuruTip, @Query("durum") durum?: PartnerBasvuruDurum) {
    return this.partner.listele(tip, durum);
  }

  @Patch(":id/durum")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.STORE_MANAGE_ALL)
  durumGuncelle(@Param("id") id: string, @Body() body: { durum: PartnerBasvuruDurum; not?: string }) {
    return this.partner.durumGuncelle(id, body.durum, body.not);
  }
}
