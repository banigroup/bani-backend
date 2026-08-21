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

type PrismaBenzeri = PrismaService | Prisma.TransactionClient;

/** Okuma kapsami. Verilmezse PLATFORM (storeId IS NULL) okunur. */
export interface RolKapsami {
  storeId: string;
}

/**
 * Kullanicinin rolleri. VARSAYILAN KAPSAM PLATFORM'dur (storeId IS NULL).
 *
 * C1 ONCESI bu fonksiyon TUM satirlari okuyordu; bugun fark yok (her satir
 * NULL) ama ilk magaza kapsamli satir yazildigi an o satir da platform rolu
 * gibi donerdi - KYC kilidi (load.service.belgeKontrolu) ve token uretimi
 * (auth.service) o listeye bakiyor. Varsayilanin platform olmasi, kapsam
 * geldiginde SESSIZ yetki genislemesini engeller: kapsamli rol istemek ACIK
 * bir parametre gerektirir.
 *
 * Tekillestirilir: storeId NULL iken bilesik unique NULL != NULL yuzunden ayni
 * rolu iki kez kabul edebilir (bkz. schema UserRole), izin kumesi bundan
 * etkilenmemeli.
 */
export async function rolleriOku(prisma: PrismaBenzeri, userId: string, kapsam?: RolKapsami): Promise<Role[]> {
  const satirlar = await prisma.userRole.findMany({
    where: { userId, storeId: kapsam ? kapsam.storeId : null },
    select: { role: true },
  });
  return [...new Set(satirlar.map((s) => s.role))];
}

/** rolleriAyir'in girdisi: kapsam bilgisini tasiyan ham satir. */
export interface KapsamliRolSatiri {
  role: Role;
  storeId: string | null;
}

/** Platform rolleri ile magaza rolleri, ayrilmis hali. */
export interface AyrilmisRoller {
  roles: Role[];
  magazaRolleri: Record<string, Role[]>;
}

/**
 * KAPSAM AYRIMININ TEK YERI. JwtStrategy bunu cagirir; baska bir yerde ikinci
 * bir ayirma yazilmamali - "platform rolu hangisi" sorusunun iki cevabi olursa
 * A1 oncesindeki isAdmin dagilmasinin aynisi geri gelir.
 *
 * Sorgu ACMAZ: cagiran taraf satirlari zaten okumus olur (JwtStrategy'de mevcut
 * include'a storeId eklendi, yeni gidis-donus yok).
 */
export function rolleriAyir(satirlar: KapsamliRolSatiri[]): AyrilmisRoller {
  const platform = new Set<Role>();
  const magazaRolleri: Record<string, Role[]> = {};
  for (const s of satirlar) {
    if (s.storeId === null) {
      platform.add(s.role);
      continue;
    }
    const kume = magazaRolleri[s.storeId] ?? (magazaRolleri[s.storeId] = []);
    if (!kume.includes(s.role)) kume.push(s.role); // nullable-unique tekillestirmesi
  }
  return { roles: [...platform], magazaRolleri };
}

/**
 * Rolleri TOPLUCA yazar: gonderilen liste NIHAI durumdur (eksikler kaldirilir).
 * Katalogdaki urun<->secenek grubu eslesmesiyle ayni desen - kismi guncellemede
 * istemcinin iki cagri arasinda tutarsiz durum birakma ihtimali ortadan kalkar.
 *
 * TEK TRANSACTION: silme ile yazma arasinda kullanici ROLSUZ kalmaz.
 *
 * KAPSAM SINIRI BILEREK KONULDU — C'NIN ON SARTI: silme kosulu
 * `{ userId, storeId: null }`, yani YALNIZCA platform satirlarina dokunur.
 * Kosuldan `storeId: null` cikarilirsa bir kisiye platform rolu atamak onun
 * TUM magaza rollerini sessizce siler; boyle bir silme audit'te "rol
 * kaldirildi" olarak bile gorunmez cunku metadata platform listesinden
 * uretiliyor. Magaza kapsamli yazma AYRI bir kapidan gelecek (C4), bu
 * fonksiyon genisletilerek DEGIL.
 */
export async function rolleriYaz(prisma: PrismaService, userId: string, roller: Role[]): Promise<Role[]> {
  const tekil = [...new Set(roller)];
  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId, storeId: null } }),
    prisma.userRole.createMany({ data: tekil.map((role) => ({ userId, role, storeId: null })) }),
  ]);
  return tekil;
}
