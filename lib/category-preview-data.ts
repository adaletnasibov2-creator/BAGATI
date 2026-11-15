/**
 * Sample data for the database-free preview routes (/storefront-preview, /storefront-preview/categories). Built from
 * the reviewed seed so the preview looks like production after prod-categories-seed.sql. Counts are made up.
 * Never used by real pages.
 */
import { CATEGORY_SEED } from "@/lib/category-seed";
import type { PublicCategoryNode } from "@/lib/public-category-tree";

export const previewCategoryTree: PublicCategoryNode[] = CATEGORY_SEED.map((top, topIndex) => {
  const children = top.children.map((child, index) => ({
    id: child.slug,
    name: child.name,
    slug: child.slug,
    parentId: top.slug,
    iconKey: null,
    imageUrl: null,
    parentIconKey: top.iconKey,
    count: ((topIndex * 7 + index * 5) % 23) + 1,
  }));
  return {
    id: top.slug,
    name: top.name,
    slug: top.slug,
    parentId: null,
    iconKey: top.iconKey,
    imageUrl: null,
    parentIconKey: null,
    count: children.reduce((sum, child) => sum + child.count, 0) + 3,
    children,
  };
});

/** Flat rows (pickers, admin) in the same shape the APIs return. */
export const previewCategoryRows = previewCategoryTree.flatMap((top, topIndex) => [
  { id: top.id, name: top.name, slug: top.slug, parentId: null, isActive: true, sortOrder: CATEGORY_SEED[topIndex].sortOrder, iconKey: top.iconKey, imageUrl: null },
  ...top.children.map((child, index) => ({ id: child.id, name: child.name, slug: child.slug, parentId: top.id, isActive: true, sortOrder: (index + 1) * 10, iconKey: null, imageUrl: null })),
]);
