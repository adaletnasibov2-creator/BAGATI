ALTER TABLE "Store"
  ADD COLUMN "bannerUrl" TEXT,
  ADD COLUMN "theme" TEXT NOT NULL DEFAULT 'forest';

ALTER TABLE "Store"
  ADD CONSTRAINT "Store_theme_check"
  CHECK ("theme" IN ('forest', 'ocean', 'copper'));
