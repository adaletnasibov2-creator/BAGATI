-- Seller applications (Variant B). A customer applies, the role stays CUSTOMER, an admin approves or rejects.
-- Additive: one new table and two enums. No existing column, row, constraint or index is changed or removed.
-- Existing sellers are backfilled as APPROVED/LEGACY rows (history only: access still depends on User.role).
-- The backfill is idempotent and can be run again after deployment (see the LEGACY BACKFILL markers).

-- CreateEnum
CREATE TYPE "VendorApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "VendorApplicationSource" AS ENUM ('SELF', 'ADMIN', 'LEGACY');

-- CreateTable
CREATE TABLE "VendorApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "VendorApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "source" "VendorApplicationSource" NOT NULL DEFAULT 'SELF',
    "openUserId" TEXT,
    "displayName" TEXT NOT NULL,
    "phone" TEXT,
    "sellerType" "SellerType",
    "legalName" TEXT,
    "voen" TEXT,
    "voenNormalized" TEXT,
    "legalAddress" TEXT,
    "plannedStoreName" TEXT,
    "applicantNote" TEXT,
    "adminNote" TEXT,
    "rejectionReason" TEXT,
    "duplicateVoenConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "vendorProfileId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorApplication_openUserId_key" ON "VendorApplication"("openUserId");

-- CreateIndex
CREATE INDEX "VendorApplication_status_createdAt_idx" ON "VendorApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VendorApplication_userId_createdAt_idx" ON "VendorApplication"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorApplication_voenNormalized_idx" ON "VendorApplication"("voenNormalized");

-- AddForeignKey
ALTER TABLE "VendorApplication" ADD CONSTRAINT "VendorApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorApplication" ADD CONSTRAINT "VendorApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorApplication" ADD CONSTRAINT "VendorApplication_vendorProfileId_fkey" FOREIGN KEY ("vendorProfileId") REFERENCES "VendorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECK constraints (not modelled by Prisma; "prisma migrate diff" ignores them).
-- One open application per user: openUserId equals userId exactly while PENDING and is NULL otherwise.
-- With the unique index above, a second PENDING row for the same user is rejected by the database.
ALTER TABLE "VendorApplication" ADD CONSTRAINT "VendorApplication_open_user_check" CHECK (
  ("status" = 'PENDING' AND "openUserId" IS NOT NULL AND "openUserId" = "userId")
  OR ("status" <> 'PENDING' AND "openUserId" IS NULL)
);
ALTER TABLE "VendorApplication" ADD CONSTRAINT "VendorApplication_note_length_check" CHECK (
  ("applicantNote" IS NULL OR char_length("applicantNote") <= 1000)
  AND ("adminNote" IS NULL OR char_length("adminNote") <= 1000)
  AND ("rejectionReason" IS NULL OR char_length("rejectionReason") <= 500)
);
ALTER TABLE "VendorApplication" ADD CONSTRAINT "VendorApplication_rejection_reason_check" CHECK (
  "status" <> 'REJECTED' OR ("rejectionReason" IS NOT NULL AND char_length(btrim("rejectionReason")) > 0)
);
ALTER TABLE "VendorApplication" ADD CONSTRAINT "VendorApplication_reviewed_check" CHECK (
  "status" NOT IN ('APPROVED', 'REJECTED') OR "reviewedAt" IS NOT NULL
);
ALTER TABLE "VendorApplication" ADD CONSTRAINT "VendorApplication_withdrawn_check" CHECK (
  "status" <> 'WITHDRAWN' OR "withdrawnAt" IS NOT NULL
);
-- New applications need a 10-digit VOEN. ADMIN and LEGACY rows are exempt (older data may not match).
ALTER TABLE "VendorApplication" ADD CONSTRAINT "VendorApplication_self_voen_check" CHECK (
  "source" <> 'SELF' OR ("voenNormalized" IS NOT NULL AND "voenNormalized" ~ '^[0-9]{10}$')
);
-- ADMIN and LEGACY rows only record sellers that already exist, so they are always APPROVED.
ALTER TABLE "VendorApplication" ADD CONSTRAINT "VendorApplication_source_status_check" CHECK (
  "source" = 'SELF' OR "status" = 'APPROVED'
);

-- >>> LEGACY BACKFILL (idempotent; also run once more right after deployment)
-- Guard 1: every VENDOR user must have a VendorProfile, otherwise nothing is backfilled.
DO $$
DECLARE
  missing integer;
BEGIN
  SELECT count(*) INTO missing
  FROM "User" u
  WHERE u."role" = 'VENDOR'
    AND NOT EXISTS (SELECT 1 FROM "VendorProfile" p WHERE p."userId" = u."id");
  IF missing > 0 THEN
    RAISE EXCEPTION 'ABORT: % VENDOR user(s) have no VendorProfile; fix them before the seller application backfill', missing;
  END IF;
END
$$;

-- One APPROVED/LEGACY row per VENDOR user that has no APPROVED row yet. Copies the live VendorProfile values.
INSERT INTO "VendorApplication" (
  "id", "userId", "status", "source", "openUserId", "displayName", "phone", "sellerType", "legalName", "voen",
  "voenNormalized", "legalAddress", "vendorProfileId", "reviewedAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text, u."id", 'APPROVED', 'LEGACY', NULL, p."displayName", p."phone", p."sellerType", p."legalName", p."voen",
  NULLIF(regexp_replace(COALESCE(p."voen", ''), '[^0-9]', '', 'g'), ''), p."legalAddress", p."id",
  (now() AT TIME ZONE 'UTC'), u."createdAt", (now() AT TIME ZONE 'UTC')
FROM "User" u
JOIN "VendorProfile" p ON p."userId" = u."id"
WHERE u."role" = 'VENDOR'
  AND NOT EXISTS (
    SELECT 1 FROM "VendorApplication" a WHERE a."userId" = u."id" AND a."status" = 'APPROVED'
  );

-- Guard 2: the number of VENDOR users must equal the number of APPROVED rows.
DO $$
DECLARE
  vendors integer;
  approved integer;
BEGIN
  SELECT count(*) INTO vendors FROM "User" WHERE "role" = 'VENDOR';
  SELECT count(*) INTO approved FROM "VendorApplication" WHERE "status" = 'APPROVED';
  IF vendors <> approved THEN
    RAISE EXCEPTION 'ABORT: % VENDOR user(s) but % APPROVED seller application(s) after the backfill', vendors, approved;
  END IF;
END
$$;
-- <<< LEGACY BACKFILL
