CREATE TYPE "SubscriptionAccessSource" AS ENUM ('UNKNOWN', 'ADMIN_MANUAL', 'PAYMENT_CONFIRMED');

ALTER TABLE "StoreSubscription"
  ADD COLUMN "accessSource" "SubscriptionAccessSource" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "grantedByAdminId" TEXT,
  ADD COLUMN "grantReason" TEXT;

CREATE INDEX "StoreSubscription_grantedByAdminId_idx" ON "StoreSubscription"("grantedByAdminId");

ALTER TABLE "StoreSubscription"
  ADD CONSTRAINT "StoreSubscription_grantedByAdminId_fkey"
  FOREIGN KEY ("grantedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
