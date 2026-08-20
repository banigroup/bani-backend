import { Role } from '@prisma/client';

// ROL YARGILARI — TEK KAYNAK.
//
// "Platform yoneticisi kim?" sorusu bu dosyadan once DORT yerde ayri ayri
// yazilmisti: orders.service.isAdmin, load.service.isAdmin,
// evdeneve.service.isAdmin ve market.service.platformYoneticisi. Bu kopyalarin
// ayrismasi somut bir hataya yol acmisti: ADMIN rolu Faz 5'te eklendiginde
// orders.service'teki kopya guncellenmedi ve ADMIN, izni olmasina ragmen
// siparis verisine erisemedi (bkz. orders.service yorumu).
//
// C adiminda rol kontrolu magaza kapsamli hale gelecek; kural TEK yerde
// oldugunda o degisiklik de tek yerde yapilacak.

/** Platform yoneticisi: ADMIN ve SUPER_ADMIN. */
export function platformYoneticisi(roles: Role[] | undefined): boolean {
  const r = roles ?? [];
  return r.includes(Role.ADMIN) || r.includes(Role.SUPER_ADMIN);
}
