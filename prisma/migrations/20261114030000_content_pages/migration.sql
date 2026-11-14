-- CreateTable
CREATE TABLE "ContentPage" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(32) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "ContentPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPageRevision" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "note" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ContentPageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentPage_slug_key" ON "ContentPage"("slug");

-- CreateIndex
CREATE INDEX "ContentPageRevision_pageId_createdAt_idx" ON "ContentPageRevision"("pageId", "createdAt");

-- AddForeignKey
ALTER TABLE "ContentPage" ADD CONSTRAINT "ContentPage_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPageRevision" ADD CONSTRAINT "ContentPageRevision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "ContentPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPageRevision" ADD CONSTRAINT "ContentPageRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CHECK constraints (not modelled by Prisma; "prisma migrate diff" ignores them).
ALTER TABLE "ContentPage" ADD CONSTRAINT "ContentPage_values_check" CHECK (
  "slug" IN ('terms', 'privacy', 'about', 'help')
  AND char_length(btrim("title")) > 0
  AND char_length("body") <= 50000
);
ALTER TABLE "ContentPageRevision" ADD CONSTRAINT "ContentPageRevision_values_check" CHECK (
  char_length(btrim("title")) > 0
  AND char_length("body") <= 50000
  AND ("note" IS NULL OR char_length("note") <= 200)
);
