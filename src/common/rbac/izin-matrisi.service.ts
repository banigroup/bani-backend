import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * FAZ 1 / A2 — izin matrisinin TEK KAYNAGI: role_permissions tablosu.
 *
 * Matris her istekte okunuyor (59 uc @RequirePermissions kullaniyor), ama satir
 * sayisi kucuk (bugun 113) ve seyrek degisiyor. O yuzden tamami bellekte tutulur,
 * TTL dolunca tazelenir. Panelden degisiklik yapildiginda (A2/adim 2) temizle()
 * cagrilir ve degisiklik TTL beklemeden yansir.
 */
@Injectable()
export class IzinMatrisi {
  private readonly logger = new Logger('IzinMatrisi');
  private static readonly TTL_MS = 60_000;

  private onbellek: Map<Role, Set<string>> | null = null;
  private yuklemeZamani = 0;
  // Ayni anda gelen isteklerin hepsi DB'ye gitmesin: ilk yukleme paylasilir.
  private yukleme: Promise<Map<Role, Set<string>>> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async izinler(roller: Role[]): Promise<Set<string>> {
    const matris = await this.matrisiAl();
    const sonuc = new Set<string>();
    for (const rol of roller) matris.get(rol)?.forEach((p) => sonuc.add(p));
    return sonuc;
  }

  /** Panelden izin degisince cagrilir: sonraki istek tazesini okur. */
  temizle(): void {
    this.onbellek = null;
    this.yuklemeZamani = 0;
  }

  private async matrisiAl(): Promise<Map<Role, Set<string>>> {
    const taze = this.onbellek && Date.now() - this.yuklemeZamani < IzinMatrisi.TTL_MS;
    if (taze) return this.onbellek!;
    if (this.yukleme) return this.yukleme;

    this.yukleme = this.yukle().finally(() => { this.yukleme = null; });
    return this.yukleme;
  }

  private async yukle(): Promise<Map<Role, Set<string>>> {
    let satirlar;
    try {
      satirlar = await this.prisma.rolePermission.findMany({ select: { role: true, permissionKey: true } });
    } catch (e) {
      // DB'ye ulasilamiyor. ESKI matris varsa onunla devam edilir (bayat ama
      // dogru); yoksa hata yukari birakilir. Bos kume DONDURULMEZ: o, sessizce
      // herkesi 403'e dusurup arizayi "yetki sorunu" gibi gosterirdi.
      if (this.onbellek) {
        this.logger.warn(`Izin matrisi tazelenemedi, onbellek kullaniliyor: ${(e as Error).message}`);
        return this.onbellek;
      }
      throw e;
    }

    // Tablo BOS olmamali: A2 migration'i 113 satirla dolduruyor. Bos gelmesi
    // yanlis veritabani ya da elle silme demektir - fail-closed davranilir ama
    // sebep loglanir, yoksa "herkes 403 aliyor" arizasi koru koru aranir.
    if (satirlar.length === 0) this.logger.error('role_permissions BOS - tum izin kontrolleri reddedilecek');

    const matris = new Map<Role, Set<string>>();
    for (const s of satirlar) {
      let kume = matris.get(s.role);
      if (!kume) { kume = new Set(); matris.set(s.role, kume); }
      kume.add(s.permissionKey);
    }
    this.onbellek = matris;
    this.yuklemeZamani = Date.now();
    return matris;
  }
}
