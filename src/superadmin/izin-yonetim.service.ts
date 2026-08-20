import { BadRequestException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IzinMatrisi } from '../common/rbac/izin-matrisi.service';
import { Permission } from '../common/rbac/permissions.enum';

/**
 * FAZ 1 / A2 adim 2 — izin matrisini panelden yonetme.
 *
 * Yazma yolunun tek kapisi burasi: her degisiklikten sonra IzinMatrisi.temizle()
 * cagrilir, yoksa degisiklik TTL (60 sn) doluncaya kadar yansimazdi.
 */
@Injectable()
export class IzinYonetimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matris: IzinMatrisi,
  ) {}

  /** Tanimli tum izinler (panelin sol listesi). */
  izinler() {
    return this.prisma.permission.findMany({
      select: { key: true, description: true },
      orderBy: { key: 'asc' },
    });
  }

  /**
   * Tum matris: HER rol icin bir satir - izni olmayan rol de bos dizi ile doner.
   * Panel ekrani eksik rolu "yok" diye gostermesin diye Role enum'i taban aliniyor.
   */
  async matrisOku(): Promise<Record<string, string[]>> {
    const satirlar = await this.prisma.rolePermission.findMany({
      select: { role: true, permissionKey: true },
      orderBy: { permissionKey: 'asc' },
    });
    const sonuc: Record<string, string[]> = {};
    for (const rol of Object.values(Role)) sonuc[rol] = [];
    for (const s of satirlar) sonuc[s.role].push(s.permissionKey);
    return sonuc;
  }

  async rolIzinleri(role: string): Promise<string[]> {
    const rol = this.rolDogrula(role);
    const satirlar = await this.prisma.rolePermission.findMany({
      where: { role: rol },
      select: { permissionKey: true },
      orderBy: { permissionKey: 'asc' },
    });
    return satirlar.map((s) => s.permissionKey);
  }

  /** Idempotent: izin zaten varsa degisti=false doner, hata atmaz. */
  async ver(role: string, permission: string): Promise<{ degisti: boolean; roller: string[] }> {
    const rol = this.rolDogrula(role);
    await this.izinDogrula(permission);

    const mevcut = await this.prisma.rolePermission.findUnique({
      where: { role_permissionKey: { role: rol, permissionKey: permission } },
      select: { id: true },
    });
    if (mevcut) return { degisti: false, roller: await this.rolIzinleri(rol) };

    await this.prisma.rolePermission.create({ data: { role: rol, permissionKey: permission } });
    this.matris.temizle();
    return { degisti: true, roller: await this.rolIzinleri(rol) };
  }

  /** Idempotent: izin zaten yoksa degisti=false doner. */
  async al(role: string, permission: string): Promise<{ degisti: boolean; roller: string[] }> {
    const rol = this.rolDogrula(role);
    await this.izinDogrula(permission);

    // KILITLENME KORUMASI: SUPER_ADMIN'den izin yonetimi alinirsa izin ekranini
    // bir daha kimse acamaz - geri donusu yalnizca elle SQL olurdu.
    if (rol === Role.SUPER_ADMIN && permission === Permission.PERMISSION_MANAGE) {
      throw new BadRequestException('SUPER_ADMIN rolunden izin yonetimi alinamaz: sistem kilitlenirdi.');
    }

    const silinen = await this.prisma.rolePermission.deleteMany({
      where: { role: rol, permissionKey: permission },
    });
    if (silinen.count === 0) return { degisti: false, roller: await this.rolIzinleri(rol) };

    this.matris.temizle();
    return { degisti: true, roller: await this.rolIzinleri(rol) };
  }

  private rolDogrula(role: string): Role {
    if (!(Object.values(Role) as string[]).includes(role)) {
      throw new BadRequestException(`Gecersiz rol: ${role}`);
    }
    return role as Role;
  }

  // Izin TABLODA tanimli olmali. FK zaten engelliyor ama mesaji Prisma'ya
  // birakmak "P2003" gibi bir hata dondururdu; panel icin acik metin daha iyi.
  private async izinDogrula(permission: string): Promise<void> {
    const kayit = await this.prisma.permission.findUnique({ where: { key: permission }, select: { key: true } });
    if (!kayit) throw new BadRequestException(`Tanimsiz izin: ${permission}`);
  }
}
