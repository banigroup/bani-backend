-- CreateEnum
CREATE TYPE "TeklifTaraf" AS ENUM ('TASIYICI', 'FIRMA');

-- AlterTable
ALTER TABLE "arac_teklifleri" ADD COLUMN     "beklenenTaraf" "TeklifTaraf" NOT NULL DEFAULT 'TASIYICI';
