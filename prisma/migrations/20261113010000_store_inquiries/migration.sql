-- Additive only. Buyer-to-store messages from the public store page.
-- No existing table, column, row, constraint or index is changed.

CREATE TYPE "StoreInquiryStatus" AS ENUM ('NEW', 'READ');

CREATE TABLE "StoreInquiry" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "contactEmail" VARCHAR(254),
    "contactPhone" VARCHAR(16),
    "message" VARCHAR(2000) NOT NULL,
    "status" "StoreInquiryStatus" NOT NULL DEFAULT 'NEW',
    "ipHash" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "StoreInquiry_pkey" PRIMARY KEY ("id"),
    -- A buyer must leave at least one way to reply.
    CONSTRAINT "StoreInquiry_contact_present_check"
        CHECK ("contactEmail" IS NOT NULL OR "contactPhone" IS NOT NULL),
    CONSTRAINT "StoreInquiry_name_message_nonblank_check"
        CHECK (length(btrim("name")) > 0 AND length(btrim("message")) > 0)
);

CREATE INDEX "StoreInquiry_storeId_status_createdAt_idx" ON "StoreInquiry"("storeId", "status", "createdAt");

CREATE INDEX "StoreInquiry_storeId_createdAt_idx" ON "StoreInquiry"("storeId", "createdAt");

ALTER TABLE "StoreInquiry" ADD CONSTRAINT "StoreInquiry_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
