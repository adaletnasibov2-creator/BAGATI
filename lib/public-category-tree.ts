/**
 * Public category tree with counts of visible products.
 *
 * Visibility = exactly the product list's rules: publicProductCatalogCandidateWhere (active product, store
 * eligibility base, optional city) and then resolvePublicStoreEligibility (the same isPublicStoreEligible the
 * catalog applies per candidate). Stock is not a visibility rule in the catalog, so it is not one here either.
 *
 * Public lists (mega menu, mobile menu, filters, homepage) show only categories with at least one visible product
 * (owner decision 2026-11-15, also for top-levels). Seller/admin pickers use loadAllCategoryRows instead.
 */
import { cache } from "react";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publicProductCatalogCandidateWhere } from "@/lib/public-product-catalog";
import { resolvePublicStoreEligibility } from "@/lib/store-eligibility";
import type { PublicStoreEligibilityClient } from "@/lib/public-store-eligibility";
import { publicCategoryTree, type CategoryRow } from "@/lib/category-tree";

export const categoryRowSelect = {
  id: true, name: true, slug: true, parentId: true, isActive: true, sortOrder: true, iconKey: true, imageUrl: true,
} satisfies Prisma.CategorySelect;

export type PublicCategory = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  iconKey: string | null;
  imageUrl: string | null;
  parentIconKey: string | null;
  count: number;
};
export type PublicCategoryNode = PublicCategory & { children: PublicCategory[] };

type CategoryReader = Pick<PrismaClient, "category">;
type CountReader = Pick<PrismaClient, "product"> & PublicStoreEligibilityClient;

export async function loadAllCategoryRows(db: CategoryReader = prisma): Promise<CategoryRow[]> {
  return db.category.findMany({ select: categoryRowSelect, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

/** Direct (not rolled-up) visible product counts per category id. */
export async function countVisibleProductsByCategory(db: CountReader = prisma, now = new Date(), citySlug?: string | null): Promise<Map<string, number>> {
  const groups = await db.product.groupBy({
    by: ["categoryId", "storeId"],
    where: { AND: [publicProductCatalogCandidateWhere({ citySlug: citySlug || null }, now), { categoryId: { not: null } }] },
    _count: { _all: true },
  });
  const eligible = await resolvePublicStoreEligibility(groups.map((group) => group.storeId), db, now);
  const counts = new Map<string, number>();
  for (const group of groups) {
    if (!group.categoryId || !eligible.has(group.storeId)) continue;
    counts.set(group.categoryId, (counts.get(group.categoryId) ?? 0) + group._count._all);
  }
  return counts;
}

export function toPublicTree(rows: readonly CategoryRow[], counts: ReadonlyMap<string, number>): PublicCategoryNode[] {
  return publicCategoryTree(rows, counts).map((top) => ({
    id: top.id, name: top.name, slug: top.slug, parentId: null, iconKey: top.iconKey, imageUrl: top.imageUrl, parentIconKey: null, count: top.count,
    children: top.children.map((child) => ({
      id: child.id, name: child.name, slug: child.slug, parentId: top.id, iconKey: child.iconKey, imageUrl: child.imageUrl, parentIconKey: top.iconKey, count: child.count,
    })),
  }));
}

export type PublicCategoryData = { rows: CategoryRow[]; counts: Map<string, number>; tree: PublicCategoryNode[] };

/** One query pair per request (React cache): layout, page and metadata share it. */
export const getPublicCategoryData = cache(async (citySlug?: string | null): Promise<PublicCategoryData> => {
  const now = new Date();
  const [rows, counts] = await Promise.all([loadAllCategoryRows(), countVisibleProductsByCategory(prisma, now, citySlug)]);
  return { rows, counts, tree: toPublicTree(rows, counts) };
});
