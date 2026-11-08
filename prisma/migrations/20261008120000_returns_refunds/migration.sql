CREATE TYPE "ReturnResolution" AS ENUM ('REFUND', 'EXCHANGE');

CREATE TYPE "ReturnStatus" AS ENUM (
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'ITEM_RECEIVED',
  'REFUND_PENDING',
  'REFUNDED',
  'EXCHANGE_PENDING',
  'EXCHANGED',
  'CANCELLED'
);

CREATE TABLE "ReturnRequest" (
  "id" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "storeOrderId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "explanation" TEXT,
  "resolution" "ReturnResolution" NOT NULL,
  "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
  "refundAmount" DECIMAL(12,2) NOT NULL,
  "vendorResponse" TEXT,
  "adminNote" TEXT,
  "stockRestoredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReturnRequest_orderItemId_key" ON "ReturnRequest"("orderItemId");
CREATE INDEX "ReturnRequest_customerId_createdAt_idx" ON "ReturnRequest"("customerId", "createdAt");
CREATE INDEX "ReturnRequest_storeId_status_createdAt_idx" ON "ReturnRequest"("storeId", "status", "createdAt");
CREATE INDEX "ReturnRequest_storeOrderId_status_idx" ON "ReturnRequest"("storeOrderId", "status");

ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_storeOrderId_fkey"
  FOREIGN KEY ("storeOrderId") REFERENCES "StoreOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_storeId_fkey"
  FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
