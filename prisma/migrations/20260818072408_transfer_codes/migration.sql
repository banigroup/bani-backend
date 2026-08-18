-- CreateTable
CREATE TABLE "transfer_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kodHash" TEXT NOT NULL,
    "hedefOrigin" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "cihaz" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transfer_codes_kodHash_key" ON "transfer_codes"("kodHash");

-- CreateIndex
CREATE INDEX "transfer_codes_userId_idx" ON "transfer_codes"("userId");

-- CreateIndex
CREATE INDEX "transfer_codes_expiresAt_idx" ON "transfer_codes"("expiresAt");

-- AddForeignKey
ALTER TABLE "transfer_codes" ADD CONSTRAINT "transfer_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
