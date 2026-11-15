import { z } from "zod";
import { categoryChoiceMessages, checkProductCategoryChoice } from "@/lib/category-tree";

type CategoryLister = { category: { findMany(args: { select: { id: true; parentId: true; isActive: true } }): Promise<{ id: string; parentId: string | null; isActive: boolean }[]> } };

/** Optional field the pickers send: the top-level the seller picked in step 1. Read from the raw body. */
export function readCategoryParentId(body: unknown): string | null {
  const parsed = z.object({ categoryParentId: z.string().trim().min(1).max(64).nullable().optional() }).safeParse(body);
  return parsed.success ? parsed.data.categoryParentId ?? null : null;
}

/**
 * Server check for a product's category (seller and admin product forms). Returns an Azerbaijani error or null.
 * - The category must exist and be active; a subcategory's parent must be active and match `expectedParentId`.
 * - New products (previousCategoryId undefined) under a top-level that has active subcategories must pick one.
 * - An existing product that keeps its category is never blocked.
 */
export async function productCategoryChoiceError(
  db: CategoryLister,
  input: { categoryId: string | null | undefined; previousCategoryId?: string | null; expectedParentId?: string | null },
): Promise<string | null> {
  if (!input.categoryId) return null;
  const rows = await db.category.findMany({ select: { id: true, parentId: true, isActive: true } });
  const error = checkProductCategoryChoice(rows, { categoryId: input.categoryId, previousCategoryId: input.previousCategoryId, expectedParentId: input.expectedParentId });
  return error ? categoryChoiceMessages[error] : null;
}
