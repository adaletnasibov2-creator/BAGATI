-- Site settings engine, part 1. Additive: two new tables and one enum. No seed rows: an empty table means
-- every setting uses its code default (lib/settings/registry.ts), so behaviour is identical to before.
-- No existing column, row, constraint or index is changed or removed.

-- CreateEnum
CREATE TYPE "SiteSettingAction" AS ENUM ('UPDATE', 'RESET', 'ROLLBACK');

-- CreateTable
CREATE TABLE "SiteSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SiteSettingRevision" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB,
    "previousValue" JSONB,
    "action" "SiteSettingAction" NOT NULL,
    "reason" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteSettingRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteSettingRevision_key_createdAt_idx" ON "SiteSettingRevision"("key", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SiteSettingRevision_key_version_key" ON "SiteSettingRevision"("key", "version");

-- AddForeignKey
ALTER TABLE "SiteSetting" ADD CONSTRAINT "SiteSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteSettingRevision" ADD CONSTRAINT "SiteSettingRevision_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECK constraints (not modelled by Prisma; "prisma migrate diff" ignores them).
-- Keys are dotted lower-camel names such as "commission.defaultRate"; anything else is refused.
ALTER TABLE "SiteSetting" ADD CONSTRAINT "SiteSetting_key_format_check" CHECK (
  "key" ~ '^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$' AND char_length("key") <= 100
);
ALTER TABLE "SiteSetting" ADD CONSTRAINT "SiteSetting_value_size_check" CHECK (
  "value" IS NULL OR pg_column_size("value") <= 16384
);
ALTER TABLE "SiteSetting" ADD CONSTRAINT "SiteSetting_version_check" CHECK ("version" >= 1);

ALTER TABLE "SiteSettingRevision" ADD CONSTRAINT "SiteSettingRevision_key_format_check" CHECK (
  "key" ~ '^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$' AND char_length("key") <= 100
);
ALTER TABLE "SiteSettingRevision" ADD CONSTRAINT "SiteSettingRevision_version_check" CHECK ("version" >= 1);
ALTER TABLE "SiteSettingRevision" ADD CONSTRAINT "SiteSettingRevision_reason_length_check" CHECK (
  "reason" IS NULL OR char_length("reason") <= 500
);
ALTER TABLE "SiteSettingRevision" ADD CONSTRAINT "SiteSettingRevision_value_size_check" CHECK (
  ("value" IS NULL OR pg_column_size("value") <= 16384)
  AND ("previousValue" IS NULL OR pg_column_size("previousValue") <= 16384)
);
