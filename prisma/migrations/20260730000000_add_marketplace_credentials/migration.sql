-- CreateTable marketplace_credentials
CREATE TABLE "marketplace_credentials" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "version" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_credentials_tenantId_key" ON "marketplace_credentials"("tenantId");
