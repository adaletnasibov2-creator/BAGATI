-- Additive only. Adds a tier and an optional end date to admin complimentary
-- (free) store entitlements. Existing rows (expected: none) become BASIC with
-- no end date. No existing column, row, constraint or index is changed.

CREATE TYPE "EntitlementTier" AS ENUM ('BASIC', 'PRO');

ALTER TABLE "StoreComplimentaryEntitlement"
ADD COLUMN "tier" "EntitlementTier" NOT NULL DEFAULT 'BASIC',
ADD COLUMN "endsAt" TIMESTAMP(3);

-- An end date, when present, must be after the grant time.
ALTER TABLE "StoreComplimentaryEntitlement"
ADD CONSTRAINT "StoreComplimentaryEntitlement_endsAt_after_grant_check"
CHECK ("endsAt" IS NULL OR "endsAt" > "grantedAt");
