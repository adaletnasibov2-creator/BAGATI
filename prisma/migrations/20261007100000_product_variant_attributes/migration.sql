ALTER TABLE "ProductVariant"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "price" DECIMAL(12,2),
  ADD COLUMN "discountPrice" DECIMAL(12,2),
  ADD COLUMN "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ProductVariant" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE INDEX "ProductVariant_productId_isActive_idx" ON "ProductVariant"("productId", "isActive");

ALTER TABLE "OrderItem"
  ADD COLUMN "variantName" TEXT,
  ADD COLUMN "variantOptions" JSONB;
