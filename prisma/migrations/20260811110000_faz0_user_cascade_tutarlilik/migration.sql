-- ELLE YAZILMIS MIGRATION (migrate dev etkilesimsiz ortamda calismadigi icin dosya
-- elle olusturuldu; ifadeler Prisma'nin uretecegiyle birebir ayni bicimde).
--
-- SORUN: User'a bagli 21 FK'nin cascade politikasi tutarsizdi (7 Cascade / 11 Restrict
--   / 3 SetNull). 11 Restrict sayesinde AKTIF bir kullanici zaten silinemiyordu; ama
--   Restrict tarafinda hic satiri olmayan "temiz" bir hesap SILINEBILIYORDU ve o anda
--   Cascade/SetNull sessizce devreye giriyordu. Yerelde ROLLBACK icinde kanitlandi:
--
--   A) Bakiyeli cuzdan sahipsiz kaliyor. wallets.userId SetNull idi; 1.499,00 TL
--      bakiyeli cuzdan userId=NULL oldu. Bu cuzdan ARTIK BULUNAMAZ: getOrCreateUserWallet
--      userId ile arar (sorgu 0 satir dondu). Ustelik @@unique([userId,type,currency])
--      NULL'li satirlari kapsamaz (Postgres'te NULL != NULL) - test sirasinda yan yana
--      3 adet userId=NULL/USER/TRY cuzdan yaratilabildi. Kismi unique index
--      "wallets_sistem_tip_para_key" ise yalnizca PLATFORM/ESCROW'u kapsar. Yani hicbir
--      kisit oksuz USER cuzdanini engellemiyordu. LedgerEntry -> Wallet Restrict oldugu
--      icin bu cuzdan temizlenemez de: bakiye kalici olarak erisilemez hale gelir.
--
--   B) Ucuncu tarafin puani sessizce bozuluyor. load_degerlendirmeler.verenId Cascade
--      idi; puan VEREN silinince puan satiri yok oldu, ama puan ALAN kisinin
--      LoadPuan.ortalama=3 / sayi=2 degeri aynen kaldi (gercek satir sayisi 1 -> 0).
--      LoadPuan artimli guncellenir (load.service.ts ~930), yeniden hesaplama yolu YOK.
--      Yani silinen kullanici uzerinden BASKASININ profili kalici olarak yanlislasir.
--
--   C) Teslimat is delili kayboluyor. deliveries.courierId SetNull idi; kurye silinince
--      tamamlanmis teslimat "kim yapti" bilgisini sessizce kaybediyordu.
--
-- COZUM: Tek kural - HARD DELETE YOK. Bu kural uygulama katmaninda zaten var
--   (users.deletedAt + UserStatus.DELETED; okumalar deletedAt: null suzuyor) ama DB'de
--   karsiligi yoktu. Deger/delil tasiyan uc bag Restrict yapilir; boylece hard delete
--   sessizce basarili olmak yerine GURULTULU HATA verir. Ayni ilke: 20260811085033,
--   20260811093000, 20260811101500.
--
--   BILEREK CASCADE BIRAKILANLAR (social_identities, refresh_tokens, addresses, carts,
--   load_puanlari): oturum/tercih/turetilmis veri. Kullanici olmadan anlamsizdirlar,
--   kayiplari kayip degildir ve ucuncu tarafi etkilemezler; ileride KVKK silme talebi
--   gelirse temiz cikis yolu olarak kalmalari gerekir.
--   BILEREK SETNULL BIRAKILAN (otp_requests.userId): sureli/atilabilir kayit, phone
--   alani zaten dolu; userId kaybi bilgi kaybi degildir.
--
-- VERIYE ETKISI: YOK. Sadece FK kisitlarinin ON DELETE davranisi degisir; ALTER COLUMN /
--   UPDATE / DELETE yoktur. wallets.userId NULLABLE KALIR - sistem cuzdanlari
--   (PLATFORM/ESCROW) userId=NULL ile durur ve Restrict NULL satirlari etkilemez.
--   Kodda user.delete / deleteMany cagiran bir yol YOK (src + prisma scriptleri tarandi),
--   dolayisiyla bu kural tamamen ileriye donuk korumadir.
--   Canlida dogrulandi (salt okuma): oksuz USER cuzdani = 0, kuryesi atanmis teslimat = 0,
--   farkli alanId = 3 ve LoadPuan satiri = 3 (tutarli). 58 kullanici / 4 cuzdan /
--   39 degerlendirme / 24 teslimat. Yani mevcut veride bu hatanin kurbani YOK.
--   Geri alma: ayni ifadeler RESTRICT yerine wallets+deliveries icin SET NULL,
--   load_degerlendirmeler icin CASCADE ile.

-- DropForeignKey
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_userId_fkey";

-- DropForeignKey
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_courierId_fkey";

-- DropForeignKey
ALTER TABLE "load_degerlendirmeler" DROP CONSTRAINT "load_degerlendirmeler_verenId_fkey";

-- DropForeignKey
ALTER TABLE "load_degerlendirmeler" DROP CONSTRAINT "load_degerlendirmeler_alanId_fkey";

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_degerlendirmeler" ADD CONSTRAINT "load_degerlendirmeler_verenId_fkey" FOREIGN KEY ("verenId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_degerlendirmeler" ADD CONSTRAINT "load_degerlendirmeler_alanId_fkey" FOREIGN KEY ("alanId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
