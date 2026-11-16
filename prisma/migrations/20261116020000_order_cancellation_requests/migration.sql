-- CreateEnum
CREATE TYPE "OrderCancellationRequestStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "OrderCancellationRequest" (
    "id" TEXT NOT NULL,
    "storeOrderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "OrderCancellationRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" VARCHAR(500) NOT NULL,
    "storeResponse" VARCHAR(1000),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderCancellationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderCancellationRequest_storeOrderId_status_idx" ON "OrderCancellationRequest"("storeOrderId", "status");

-- CreateIndex
CREATE INDEX "OrderCancellationRequest_customerId_createdAt_idx" ON "OrderCancellationRequest"("customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderCancellationRequest" ADD CONSTRAINT "OrderCancellationRequest_storeOrderId_fkey" FOREIGN KEY ("storeOrderId") REFERENCES "StoreOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCancellationRequest" ADD CONSTRAINT "OrderCancellationRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCancellationRequest" ADD CONSTRAINT "OrderCancellationRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Prisma schema cannot express a partial unique index. This enforces at most one open (REQUESTED) cancellation
-- request per store order while keeping every decided, rejected or withdrawn request as history.
CREATE UNIQUE INDEX "OrderCancellationRequest_one_open_per_store_order_key"
ON "OrderCancellationRequest"("storeOrderId")
WHERE "status" = 'REQUESTED';
