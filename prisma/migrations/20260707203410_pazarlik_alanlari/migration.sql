-- AlterTable
ALTER TABLE "arac_teklifleri" ADD COLUMN     "elSayisi" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gerceklesenKurus" BIGINT,
ADD COLUMN     "ilkTalepKurus" BIGINT,
ADD COLUMN     "ilkTeklifKurus" BIGINT;

-- AlterTable
ALTER TABLE "yuk_teklifleri" ADD COLUMN     "beklenenTaraf" "TeklifTaraf" NOT NULL DEFAULT 'TASIYICI',
ADD COLUMN     "elSayisi" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gerceklesenKurus" BIGINT,
ADD COLUMN     "ilkTalepKurus" BIGINT,
ADD COLUMN     "ilkTeklifKurus" BIGINT;
