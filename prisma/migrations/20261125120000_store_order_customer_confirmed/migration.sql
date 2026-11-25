-- ORDER-NOTIFY-1: when the customer confirmed receiving one store order ("Təhvil aldım").
-- Additive only: one new nullable column on "StoreOrder" with no default (no table rewrite, no backfill).
-- IF NOT EXISTS: safe to run again (e.g. when the SQL was applied by hand before the deploy).

-- AlterTable
ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "customerConfirmedAt" TIMESTAMP(3);
