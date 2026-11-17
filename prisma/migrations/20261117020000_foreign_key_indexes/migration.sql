-- Scale part 2, phase 1: indexes for two foreign keys that had none.
-- "Inventory"."variantId" is used by every product listing (stock per variant); "OrderItem"."storeOrderId" by every
-- order page. IF NOT EXISTS keeps this safe when an index was already created by hand (CREATE INDEX CONCURRENTLY).
-- lock_timeout: give up instead of queueing behind a long transaction and blocking writes to the table.
SET lock_timeout = '5s';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Inventory_variantId_idx" ON "Inventory"("variantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderItem_storeOrderId_idx" ON "OrderItem"("storeOrderId");
