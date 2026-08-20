import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// ROL OKUMA/YAZMANIN TEK KAPISI (Faz 1 / A1).
//
// users.roles dizisi user_roles tablosuna tasindi. Tabloya dokunan yer sayisi
// kucuk ve BILEREK oyle kaliyor: rol okuma dort ayri dosyada dort ayri sekilde
// yazilsaydi, C adiminda magaza kapsami geldiginde dordu de ayri ayri
// guncellenmek zorunda kalirdi - isAdmin'in uc dosyada ayrisip ADMIN'i
// kilitlemesi tam olarak boyle olmustu.
//
// Servis degil serbest fonksiyon: cagiran yerlerin (JwtStrategy, AuthService,
// UsersService) hepsinde PrismaService zaten var, araya modul/DI baglamak
// kazanc getirmezdi.

// A1'de kapsam yok: her satir platform geneli (storeId NULL). C adiminda bu
// fonksiyon kapsamli listeye donusecek; cagiranlar tek yerden guncellenecek.
type PrismaBenzeri = PrismaService | Prisma.TransactionClient;

/**
 * Kullanicinin rolleri. Tekillestirilir: storeId NULL iken bilesik unique
 * NULL != NULL yuzunden ayni rolu iki kez kabul edebilir (bkz. schema UserRole),
 * izin kumesi bundan etkilenmemeli.
 */
export async function rolleriOku(prisma: PrismaBenzeri, userId: string): Promise<Role[]> {
  const satirlar = await prisma.userRole.findMany({
    where: { userId },
    select: { role: true },
  });
  return [...new Set(satirlar.map((s) => s.role))];
}

/**
 * Rolleri TOPLUCA yazar: gonderilen liste NIHAI durumdur (eksikler kaldirilir).
 * Katalogdaki urun<->secenek grubu eslesmesiyle ayni desen - kismi guncellemede
 * istemcinin iki cagri arasinda tutarsiz durum birakma ihtimali ortadan kalkar.
 *
 * TEK TRANSACTION: silme ile yazma arasinda kullanici ROLSUZ kalmaz.
 * A1'de yalnizca platform geneli (storeId NULL) satirlara dokunur.
 */
export async function rolleriYaz(prisma: PrismaService, userId: string, roller: Role[]): Promise<Role[]> {
  const tekil = [...new Set(roller)];
  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId, storeId: null } }),
    prisma.userRole.createMany({ data: tekil.map((role) => ({ userId, role, storeId: null })) }),
  ]);
  return tekil;
}
