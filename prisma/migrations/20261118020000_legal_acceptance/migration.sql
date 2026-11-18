-- CreateEnum
CREATE TYPE "LegalDocument" AS ENUM ('CUSTOMER_TERMS', 'SELLER_TERMS');

-- CreateEnum
CREATE TYPE "LegalAcceptanceSource" AS ENUM ('REGISTER_EMAIL', 'REGISTER_GOOGLE', 'CHECKOUT', 'SELLER_APPLICATION', 'SELLER_PANEL');

-- CreateTable
CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "document" "LegalDocument" NOT NULL,
    "version" VARCHAR(32) NOT NULL,
    "source" "LegalAcceptanceSource" NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendorApplicationId" TEXT,

    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalAcceptance_document_version_idx" ON "LegalAcceptance"("document", "version");

-- CreateIndex
CREATE INDEX "LegalAcceptance_vendorApplicationId_idx" ON "LegalAcceptance"("vendorApplicationId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalAcceptance_userId_document_version_key" ON "LegalAcceptance"("userId", "document", "version");

-- AddForeignKey
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_vendorApplicationId_fkey" FOREIGN KEY ("vendorApplicationId") REFERENCES "VendorApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
