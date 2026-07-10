-- DropForeignKey
ALTER TABLE "arac_teklifleri" DROP CONSTRAINT "arac_teklifleri_aracIlaniId_fkey";

-- DropForeignKey
ALTER TABLE "yuk_teklifleri" DROP CONSTRAINT "yuk_teklifleri_yukIlaniId_fkey";

-- AddForeignKey
ALTER TABLE "yuk_teklifleri" ADD CONSTRAINT "yuk_teklifleri_yukIlaniId_fkey" FOREIGN KEY ("yukIlaniId") REFERENCES "yuk_ilanlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arac_teklifleri" ADD CONSTRAINT "arac_teklifleri_aracIlaniId_fkey" FOREIGN KEY ("aracIlaniId") REFERENCES "arac_ilanlari"("id") ON DELETE CASCADE ON UPDATE CASCADE;
