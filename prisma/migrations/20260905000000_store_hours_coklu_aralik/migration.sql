-- DropIndex
DROP INDEX "store_hours_storeId_weekday_effectiveFrom_key";
-- AlterTable
ALTER TABLE "store_hours" ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "openTime" DROP NOT NULL,
ALTER COLUMN "closeTime" DROP NOT NULL;
-- CreateIndex
CREATE UNIQUE INDEX "store_hours_storeId_weekday_effectiveFrom_sequence_key" ON "store_hours"("storeId", "weekday", "effectiveFrom", "sequence");
