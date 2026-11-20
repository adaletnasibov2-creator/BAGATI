-- SELLER-ALERTS: optional extra notification email per store (verified before use) and its single-use tokens.
-- Additive only: two nullable columns on "Store" and one new empty table. No existing row is rewritten.
-- Written with IF NOT EXISTS / a guarded constraint, so running it twice changes nothing the second time.

-- AlterTable
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "notificationEmail" VARCHAR(254);
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "notificationEmailVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "StoreNotificationEmailToken" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreNotificationEmailToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StoreNotificationEmailToken_tokenHash_key" ON "StoreNotificationEmailToken"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StoreNotificationEmailToken_storeId_usedAt_idx" ON "StoreNotificationEmailToken"("storeId", "usedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StoreNotificationEmailToken_expiresAt_idx" ON "StoreNotificationEmailToken"("expiresAt");

-- AddForeignKey (Postgres has no ADD CONSTRAINT IF NOT EXISTS: add it only when it is missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'StoreNotificationEmailToken_storeId_fkey' AND t.relname = 'StoreNotificationEmailToken' AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE "StoreNotificationEmailToken" ADD CONSTRAINT "StoreNotificationEmailToken_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
