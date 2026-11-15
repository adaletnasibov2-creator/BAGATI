-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "iconKey" TEXT,
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Category_parentId_sortOrder_idx" ON "Category"("parentId", "sortOrder");


-- CHECK constraints (not modelled by Prisma; "prisma migrate diff" ignores them).
ALTER TABLE "Category" ADD CONSTRAINT "Category_parent_not_self_check" CHECK ("parentId" IS NULL OR "parentId" <> "id");
ALTER TABLE "Category" ADD CONSTRAINT "Category_iconKey_format_check" CHECK ("iconKey" IS NULL OR "iconKey" ~ '^[A-Za-z0-9]{1,40}$');
ALTER TABLE "Category" ADD CONSTRAINT "Category_imageUrl_length_check" CHECK ("imageUrl" IS NULL OR char_length("imageUrl") BETWEEN 1 AND 500);

-- Depth guard (max two levels). The application checks the same rule first (lib/category-tree.ts); this trigger
-- is the safety net for concurrent requests and manual SQL. The parent row is locked FOR SHARE, so a concurrent
-- move of that parent under another category waits and is then re-checked.
CREATE FUNCTION "category_tree_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  grandparent TEXT;
BEGIN
  IF NEW."parentId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."parentId" IS NOT DISTINCT FROM OLD."parentId" THEN
    RETURN NEW;
  END IF;
  SELECT c."parentId" INTO grandparent FROM "Category" c WHERE c."id" = NEW."parentId" FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CATEGORY_DEPTH: parent category % does not exist', NEW."parentId" USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF grandparent IS NOT NULL THEN
    RAISE EXCEPTION 'CATEGORY_DEPTH: parent category % is itself a subcategory', NEW."parentId" USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "Category" c WHERE c."parentId" = NEW."id") THEN
    RAISE EXCEPTION 'CATEGORY_DEPTH: category % has subcategories and cannot get a parent', NEW."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "Category_tree_guard"
  BEFORE INSERT OR UPDATE OF "parentId" ON "Category"
  FOR EACH ROW EXECUTE FUNCTION "category_tree_guard"();

-- Delete guard. The existing foreign keys are ON DELETE SET NULL; without this a deleted category would silently
-- turn its subcategories into top-levels and leave its products without a category.
CREATE FUNCTION "category_delete_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Category" c WHERE c."parentId" = OLD."id") THEN
    RAISE EXCEPTION 'CATEGORY_IN_USE: category % has subcategories', OLD."id" USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "Product" p WHERE p."categoryId" = OLD."id") THEN
    RAISE EXCEPTION 'CATEGORY_IN_USE: category % has products', OLD."id" USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END
$$;

CREATE TRIGGER "Category_delete_guard"
  BEFORE DELETE ON "Category"
  FOR EACH ROW EXECUTE FUNCTION "category_delete_guard"();
