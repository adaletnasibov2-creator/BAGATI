CREATE TYPE "StoreOrigin" AS ENUM (
    'SELLER_SUBMITTED',
    'ADMIN_CREATED',
    'LEGACY_UNKNOWN'
);

ALTER TABLE "Store"
ADD COLUMN "origin" "StoreOrigin" NOT NULL DEFAULT 'LEGACY_UNKNOWN';

-- The current schema identifies admin-managed stores and records the creating
-- admin for some stores. Leave all other historical rows unknown rather than
-- infer their onboarding path.
UPDATE "Store"
SET "origin" = 'ADMIN_CREATED'
WHERE "adminManaged" = TRUE
   OR "managedByAdminId" IS NOT NULL;

CREATE INDEX "Store_origin_idx" ON "Store"("origin");

CREATE TABLE "StoreComplimentaryEntitlement" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "grantedByAdminId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantReason" VARCHAR(500) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByAdminId" TEXT,
    "revokeReason" VARCHAR(500),

    CONSTRAINT "StoreComplimentaryEntitlement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StoreComplimentaryEntitlement_grantReason_nonblank_check"
        CHECK (
            length(btrim("grantReason", ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13))) > 0
        ),
    CONSTRAINT "StoreComplimentaryEntitlement_revocation_fields_check"
        CHECK (
            (
                "revokedAt" IS NULL
                AND "revokedByAdminId" IS NULL
                AND "revokeReason" IS NULL
            )
            OR (
                "revokedAt" IS NOT NULL
                AND "revokedByAdminId" IS NOT NULL
                AND "revokeReason" IS NOT NULL
                AND length(btrim("revokeReason", ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13))) > 0
            )
        )
);

CREATE INDEX "StoreComplimentaryEntitlement_storeId_grantedAt_idx"
ON "StoreComplimentaryEntitlement"("storeId", "grantedAt");

CREATE INDEX "StoreComplimentaryEntitlement_storeId_revokedAt_idx"
ON "StoreComplimentaryEntitlement"("storeId", "revokedAt");

CREATE INDEX "StoreComplimentaryEntitlement_grantedByAdminId_grantedAt_idx"
ON "StoreComplimentaryEntitlement"("grantedByAdminId", "grantedAt");

CREATE INDEX "StoreComplimentaryEntitlement_revokedByAdminId_revokedAt_idx"
ON "StoreComplimentaryEntitlement"("revokedByAdminId", "revokedAt");

-- Prisma schema cannot express a partial unique index. This enforces at most
-- one unrevoked grant per store while retaining all revoked grant rows.
CREATE UNIQUE INDEX "StoreComplimentaryEntitlement_one_active_per_store_key"
ON "StoreComplimentaryEntitlement"("storeId")
WHERE "revokedAt" IS NULL;

ALTER TABLE "StoreComplimentaryEntitlement"
ADD CONSTRAINT "StoreComplimentaryEntitlement_storeId_fkey"
FOREIGN KEY ("storeId") REFERENCES "Store"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StoreComplimentaryEntitlement"
ADD CONSTRAINT "StoreComplimentaryEntitlement_grantedByAdminId_fkey"
FOREIGN KEY ("grantedByAdminId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StoreComplimentaryEntitlement"
ADD CONSTRAINT "StoreComplimentaryEntitlement_revokedByAdminId_fkey"
FOREIGN KEY ("revokedByAdminId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
