-- Additive only. Admin TOTP second factor, recovery codes, admin session metadata and two AuditLog indexes.
-- No existing column, row, constraint or index is changed or removed.
-- The new AuthSession columns are nullable; existing sessions keep working unchanged.
-- Indexes are created without CONCURRENTLY: migrations run inside one transaction, where CONCURRENTLY is not
-- allowed, and AuditLog / AdminRecoveryCode are small, so the brief write lock on AuditLog is acceptable.

-- AlterTable
ALTER TABLE "AuthSession" ADD COLUMN     "ipMasked" VARCHAR(64),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "userAgent" VARCHAR(120);

-- CreateTable
CREATE TABLE "AdminTwoFactor" (
    "userId" TEXT NOT NULL,
    "secretEncrypted" VARCHAR(512) NOT NULL,
    "enrolledAt" TIMESTAMP(3),
    "lastUsedStep" INTEGER,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminTwoFactor_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AdminRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" VARCHAR(200) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminRecoveryCode_userId_usedAt_idx" ON "AdminRecoveryCode"("userId", "usedAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "AdminTwoFactor" ADD CONSTRAINT "AdminTwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminRecoveryCode" ADD CONSTRAINT "AdminRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
