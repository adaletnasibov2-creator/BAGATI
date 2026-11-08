ALTER TABLE "Promotion"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Promotion_storeId_startsAt_endsAt_idx"
  ON "Promotion"("storeId", "startsAt", "endsAt");

CREATE TABLE "PromotionProduct" (
  "id" TEXT NOT NULL,
  "promotionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromotionProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PromotionProduct_promotionId_productId_key"
  ON "PromotionProduct"("promotionId", "productId");
CREATE INDEX "PromotionProduct_productId_promotionId_idx"
  ON "PromotionProduct"("productId", "promotionId");

ALTER TABLE "PromotionProduct"
  ADD CONSTRAINT "PromotionProduct_promotionId_fkey"
    FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PromotionProduct_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
