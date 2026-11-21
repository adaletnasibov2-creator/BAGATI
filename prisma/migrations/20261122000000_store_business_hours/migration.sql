-- STORE-HOURS: optional opening hours of a store (one range for every day), stored as "HH:MM" text.
-- Additive only: two new nullable columns on "Store" (no default, so no table rewrite) and three CHECK constraints.
-- The CHECKs scan "Store" once while the lock is held; every existing row has NULL in both new columns, so they pass.
-- One ALTER TABLE statement = one short lock on "Store".

-- AlterTable
ALTER TABLE "Store"
  ADD COLUMN "openingTime" VARCHAR(5),
  ADD COLUMN "closingTime" VARCHAR(5),
  ADD CONSTRAINT "Store_openingTime_format_check" CHECK ("openingTime" IS NULL OR "openingTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "Store_closingTime_format_check" CHECK ("closingTime" IS NULL OR "closingTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "Store_business_hours_pair_check" CHECK (
    ("openingTime" IS NULL AND "closingTime" IS NULL)
    OR ("openingTime" IS NOT NULL AND "closingTime" IS NOT NULL AND "openingTime" <> "closingTime")
  );
