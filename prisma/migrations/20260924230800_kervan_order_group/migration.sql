-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "orderGroupId" UUID;

-- CreateTable
CREATE TABLE "order_groups" (
    "id" UUID NOT NULL,
    "groupNo" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "businessUnit" "BusinessUnit" NOT NULL DEFAULT 'CARSI',
    "subtotal" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "addressId" UUID,
    "addressText" TEXT,
    "contactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_groups_groupNo_key" ON "order_groups"("groupNo");

-- CreateIndex
CREATE INDEX "order_groups_userId_createdAt_idx" ON "order_groups"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_orderGroupId_idx" ON "orders"("orderGroupId");

-- AddForeignKey
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_orderGroupId_fkey" FOREIGN KEY ("orderGroupId") REFERENCES "order_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
