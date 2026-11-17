-- Scale part 2, phase 2: ordered indexes for the public product listings, plus one partial index for /deals.
-- They follow the listings' ORDER BY ("createdAt" DESC, id DESC, or name, id), so PostgreSQL reads the first page in
-- order instead of sorting every matching product. IF NOT EXISTS keeps this safe when an index was already created
-- by hand (CREATE INDEX CONCURRENTLY, see release-output). Existing indexes are kept.
-- lock_timeout: give up instead of queueing behind a long transaction and blocking writes to "Product".
SET lock_timeout = '5s';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_status_createdAt_id_idx" ON "Product"("status", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_status_name_id_idx" ON "Product"("status", "name", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_categoryId_status_createdAt_id_idx" ON "Product"("categoryId", "status", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Product_storeId_status_createdAt_id_idx" ON "Product"("storeId", "status", "createdAt" DESC, "id" DESC);

-- Prisma schema cannot express a partial index, so this one is not in schema.prisma. It serves the /deals candidates
-- (discounted products, most recently changed first).
CREATE INDEX IF NOT EXISTS "Product_discounted_status_updatedAt_idx" ON "Product"("status", "updatedAt" DESC) WHERE "discountPrice" IS NOT NULL;
