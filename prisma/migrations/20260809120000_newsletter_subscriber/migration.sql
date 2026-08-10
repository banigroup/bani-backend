-- CreateTable
CREATE TABLE "newsletter_subscribers" (
    "id" UUID NOT NULL,
    "eposta" TEXT NOT NULL,
    "businessUnit" TEXT NOT NULL DEFAULT 'GENEL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "newsletter_subscribers_businessUnit_idx" ON "newsletter_subscribers"("businessUnit");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_eposta_businessUnit_key" ON "newsletter_subscribers"("eposta", "businessUnit");
