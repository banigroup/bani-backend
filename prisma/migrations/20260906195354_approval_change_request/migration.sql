-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ChangeRequestAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateTable
CREATE TABLE "change_requests" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "actionType" "ChangeRequestAction" NOT NULL,
    "storeId" UUID,
    "businessUnit" "BusinessUnit",
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID NOT NULL,
    "reviewedById" UUID,
    "proposedData" JSONB NOT NULL,
    "beforeData" JSONB,
    "metadata" JSONB,
    "rejectionReason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "supersedesId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_supersedesId_key" ON "change_requests"("supersedesId");

-- CreateIndex
CREATE INDEX "change_requests_status_idx" ON "change_requests"("status");

-- CreateIndex
CREATE INDEX "change_requests_entityType_status_idx" ON "change_requests"("entityType", "status");

-- CreateIndex
CREATE INDEX "change_requests_storeId_idx" ON "change_requests"("storeId");

-- CreateIndex
CREATE INDEX "change_requests_requestedById_idx" ON "change_requests"("requestedById");

-- CreateIndex
CREATE INDEX "change_requests_entityType_entityId_status_idx" ON "change_requests"("entityType", "entityId", "status");

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
