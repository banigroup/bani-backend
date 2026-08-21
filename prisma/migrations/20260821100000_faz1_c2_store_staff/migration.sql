-- FAZ 1 / C2 — ILK MAGAZA KAPSAMLI ROL: STORE_STAFF
--
-- TEK IS: Role enum'una yeni deger. Bu migration hicbir SATIR yazmiyor,
-- hicbir kisit eklemiyor, hicbir veri tasimiyor.
--
-- role_permissions'a BILEREK satir eklenmedi: C1'den sonra magaza kapsamli
-- roller AuthUser.roles'a girmiyor, dolayisiyla PermissionsGuard onlarin
-- iznini zaten cozemez. Izin vermek bugun anlamsiz olurdu; magaza kapsamli
-- izin cozumlemesi Faz 1/B'nin isi.
--
-- CHECK kisiti da BILEREK yok: "STORE_STAFF yalniz storeId DOLU, diger roller
-- yalniz NULL" kurali tek yazma kapisinda zorlanacak. Prisma CHECK'i semada
-- ifade edemedigi icin DB kisiti kalici drift uretirdi - kismi unique indeksin
-- A1'de reddedilme gerekcesinin aynisi. Bilincli kabul edilmis borctur.
--
-- ALTER TYPE ... ADD VALUE ile eklenen deger AYNI TRANSACTION icinde
-- KULLANILAMAZ (Postgres kurali). Bu migration o degeri kullanan satir
-- yazmadigi icin bolunmesi gerekmedi.

ALTER TYPE "Role" ADD VALUE 'STORE_STAFF';
