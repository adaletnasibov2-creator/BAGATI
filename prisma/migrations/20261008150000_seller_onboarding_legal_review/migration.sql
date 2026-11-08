CREATE TYPE "SellerType" AS ENUM ('INDIVIDUAL_ENTREPRENEUR', 'REGISTERED_COMPANY');

ALTER TABLE "VendorProfile"
  ADD COLUMN "sellerType" "SellerType",
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "voen" TEXT,
  ADD COLUMN "legalAddress" TEXT;

ALTER TABLE "Store"
  ADD COLUMN "reviewNote" TEXT,
  ADD COLUMN "legalInfoApproved" BOOLEAN NOT NULL DEFAULT false;
