/**
 * Two-level category tree: pure rules, no database access (unit-tested in scripts/category-tree.test.ts).
 *
 * - A category is either top-level (parentId null) or a subcategory whose parent is top-level. Never deeper.
 * - Slugs are globally unique (DB unique index); categorySlug() derives them with the project's transliteration.
 * - Order: sortOrder ascending, then name (az), and "Digər" always last among its siblings.
 *
 * The database enforces the depth rule too (trigger "category_tree_guard", migration 20261116010000).
 */
import { citySlug } from "@/lib/reference-data";

export type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  isActive: boolean;
  sortOrder: number;
  iconKey: string | null;
  imageUrl: string | null;
};

export type CategoryTreeNode<T extends CategoryRow = CategoryRow> = T & { children: T[] };

export const CATEGORY_NAME_MAX = 100;
export const CATEGORY_SLUG_MAX = 120;

/** ASCII slug with the same transliteration as the admin and reference data (ə→e, ı→i, ş→s, ...). */
export function categorySlug(text: string): string {
  return citySlug(text).slice(0, CATEGORY_SLUG_MAX).replace(/-+$/g, "");
}

export function isValidCategorySlug(value: string): boolean {
  return value.length >= 2 && value.length <= CATEGORY_SLUG_MAX && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isOther(name: string) {
  return name.trim().toLocaleLowerCase("az-AZ") === "digər";
}

export function compareCategories(left: Pick<CategoryRow, "name" | "sortOrder">, right: Pick<CategoryRow, "name" | "sortOrder">): number {
  const other = Number(isOther(left.name)) - Number(isOther(right.name));
  if (other) return other;
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  return left.name.localeCompare(right.name, "az");
}

export function sortCategories<T extends Pick<CategoryRow, "name" | "sortOrder">>(rows: readonly T[]): T[] {
  return [...rows].sort(compareCategories);
}

/**
 * Builds the ordered tree. Orphans (parent missing from `rows`) and rows below a subcategory (impossible with the
 * DB guard, but tolerated) are dropped rather than promoted, so a bad row never shows up as a new top-level.
 */
export function buildCategoryTree<T extends CategoryRow>(rows: readonly T[]): CategoryTreeNode<T>[] {
  const tops = rows.filter((row) => row.parentId === null);
  const topIds = new Set(tops.map((row) => row.id));
  const childrenByParent = new Map<string, T[]>();
  for (const row of rows) {
    if (row.parentId === null || !topIds.has(row.parentId)) continue;
    const list = childrenByParent.get(row.parentId) ?? [];
    list.push(row);
    childrenByParent.set(row.parentId, list);
  }
  return sortCategories(tops).map((top) => ({ ...top, children: sortCategories(childrenByParent.get(top.id) ?? []) }));
}

/** Tree order as a flat list (each top-level followed by its subcategories), e.g. for <select> options. */
export function flattenCategoryTree<T extends CategoryRow>(rows: readonly T[]): T[] {
  return buildCategoryTree(rows).flatMap(({ children, ...top }) => [top as unknown as T, ...children]);
}

/** Option label for flat selects: subcategories are indented under their parent. */
export function categoryOptionLabel(row: { name: string; parentId: string | null }): string {
  return row.parentId ? `  — ${row.name}` : row.name;
}

export type PlacementError = "PARENT_NOT_FOUND" | "PARENT_IS_SUBCATEGORY" | "HAS_CHILDREN" | "SELF_PARENT";

export const placementErrorMessages: Record<PlacementError, string> = {
  PARENT_NOT_FOUND: "Üst kateqoriya tapılmadı.",
  PARENT_IS_SUBCATEGORY: "Alt kateqoriyanın altına kateqoriya əlavə etmək olmaz: yalnız iki səviyyə var.",
  HAS_CHILDREN: "Alt kateqoriyaları olan kateqoriya başqa kateqoriyanın altına köçürülə bilməz.",
  SELF_PARENT: "Kateqoriya özünün üst kateqoriyası ola bilməz.",
};

/**
 * Depth rule for creating (id undefined) or moving a category under `parentId`.
 * `rows` must contain at least the parent and, for a move, every category whose parent is `id`.
 */
export function checkCategoryPlacement(
  rows: readonly Pick<CategoryRow, "id" | "parentId">[],
  input: { id?: string; parentId: string | null },
): PlacementError | null {
  if (input.parentId === null) return null;
  if (input.id && input.id === input.parentId) return "SELF_PARENT";
  const parent = rows.find((row) => row.id === input.parentId);
  if (!parent) return "PARENT_NOT_FOUND";
  if (parent.parentId !== null) return "PARENT_IS_SUBCATEGORY";
  if (input.id && rows.some((row) => row.parentId === input.id)) return "HAS_CHILDREN";
  return null;
}

/** First unused slug: base, base-2, base-3, ... (`taken` = every existing slug). */
export function uniqueCategorySlug(base: string, taken: ReadonlySet<string>): string {
  const root = base || "kateqoriya";
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root.slice(0, CATEGORY_SLUG_MAX - String(n).length - 1)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("CATEGORY_SLUG_EXHAUSTED");
}

/** Category and its parent for a slug; null when unknown. */
export function findCategoryBySlug<T extends CategoryRow>(rows: readonly T[], slug: string | null | undefined): { category: T; parent: T | null } | null {
  if (!slug) return null;
  const category = rows.find((row) => row.slug === slug);
  if (!category) return null;
  const parent = category.parentId ? rows.find((row) => row.id === category.parentId) ?? null : null;
  return { category, parent };
}

/** Ids a category page lists: a top-level lists itself and all its subcategories; a subcategory only itself. */
export function categoryScopeIds(rows: readonly Pick<CategoryRow, "id" | "parentId">[], categoryId: string): string[] {
  const category = rows.find((row) => row.id === categoryId);
  if (!category) return [];
  if (category.parentId !== null) return [category.id];
  return [category.id, ...rows.filter((row) => row.parentId === category.id).map((row) => row.id)];
}

export type Crumb = { name: string; href: string | null };

/** Ana səhifə > Üst > Alt. The last crumb is the current page (href null). */
export function categoryBreadcrumbs(
  category: Pick<CategoryRow, "name" | "slug">,
  parent: Pick<CategoryRow, "name" | "slug"> | null,
  href: (slug: string) => string = categoryHref,
): Crumb[] {
  return [
    { name: "Ana səhifə", href: "/" },
    ...(parent ? [{ name: parent.name, href: href(parent.slug) }] : []),
    { name: category.name, href: null },
  ];
}

/** The canonical, shareable category URL (the existing public URL, kept for compatibility). */
export function categoryHref(slug: string): string {
  return `/products?category=${encodeURIComponent(slug)}`;
}

/**
 * Rolls direct counts up the tree: a top-level's total = its own products + all its subcategories' products.
 * Returns a map for every category id in `rows` (0 when absent).
 */
export function rollUpCategoryCounts(rows: readonly Pick<CategoryRow, "id" | "parentId">[], direct: ReadonlyMap<string, number>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.id, direct.get(row.id) ?? 0);
  for (const row of rows) {
    if (row.parentId === null) continue;
    if (!totals.has(row.parentId)) continue;
    totals.set(row.parentId, (totals.get(row.parentId) ?? 0) + (direct.get(row.id) ?? 0));
  }
  return totals;
}

export type CountedNode<T extends CategoryRow = CategoryRow> = T & { count: number; children: (T & { count: number })[] };

/**
 * Public tree: only active categories (a subcategory also needs an active parent; deactivating a parent hides its
 * subcategories without changing their own isActive). Counts are the rolled-up totals.
 * - showEmpty false: only categories with at least one visible product in their scope.
 * - showEmpty true (setting catalog.showEmptyCategories, default ON): every active category, also with count 0.
 */
export function publicCategoryTree<T extends CategoryRow>(rows: readonly T[], direct: ReadonlyMap<string, number>, options: { showEmpty?: boolean } = {}): CountedNode<T>[] {
  const showEmpty = options.showEmpty ?? false;
  const active = rows.filter((row) => row.isActive);
  const totals = rollUpCategoryCounts(active, direct);
  return buildCategoryTree(active)
    .map((top) => ({
      ...top,
      count: totals.get(top.id) ?? 0,
      children: top.children.map((child) => ({ ...child, count: totals.get(child.id) ?? 0 })).filter((child) => showEmpty || child.count > 0),
    }))
    .filter((top) => showEmpty || top.count > 0);
}

/** Is this category shown publicly at all (active, and for a subcategory an active parent)? Empty or not. */
export function isPublicCategory(rows: readonly Pick<CategoryRow, "id" | "parentId" | "isActive">[], categoryId: string): boolean {
  const category = rows.find((row) => row.id === categoryId);
  if (!category || !category.isActive) return false;
  if (category.parentId === null) return true;
  return rows.find((row) => row.id === category.parentId)?.isActive === true;
}

/**
 * Links for an empty category page (max 8, from the public tree only): for a subcategory its parent and the other
 * subcategories; for a top-level its subcategories, or the other top-levels when it has none.
 */
export function categorySiblingLinks(
  tree: readonly { id: string; name: string; slug: string; children: readonly { id: string; name: string; slug: string }[] }[],
  categoryId: string,
  limit = 8,
): { name: string; slug: string }[] {
  const pick = (items: readonly { id: string; name: string; slug: string }[]) => items.filter((item) => item.id !== categoryId).map(({ name, slug }) => ({ name, slug }));
  const top = tree.find((node) => node.id === categoryId);
  if (top) return (top.children.length ? pick(top.children) : pick(tree)).slice(0, limit);
  const parent = tree.find((node) => node.children.some((child) => child.id === categoryId));
  if (parent) return [{ name: parent.name, slug: parent.slug }, ...pick(parent.children)].slice(0, limit);
  return pick(tree).slice(0, limit);
}

export type CategoryChoiceError = "NOT_FOUND" | "INACTIVE" | "PARENT_INACTIVE" | "PARENT_MISMATCH" | "SUBCATEGORY_REQUIRED";

export const categoryChoiceMessages: Record<CategoryChoiceError, string> = {
  NOT_FOUND: "Kateqoriya tapılmadı.",
  INACTIVE: "Aktiv kateqoriya tapılmadı.",
  PARENT_INACTIVE: "Seçilmiş alt kateqoriyanın üst kateqoriyası aktiv deyil.",
  PARENT_MISMATCH: "Alt kateqoriya seçilmiş üst kateqoriyaya aid deyil.",
  SUBCATEGORY_REQUIRED: "Bu kateqoriyanın alt kateqoriyaları var: alt kateqoriya seçin.",
};

/**
 * Product category choice (seller and admin forms). `previousCategoryId` undefined = a new product.
 * An existing product that keeps its category is never blocked, even if it sits on a top-level that has
 * subcategories now. `expectedParentId`, when the form sends it, must match the subcategory's parent.
 */
export function checkProductCategoryChoice(
  rows: readonly Pick<CategoryRow, "id" | "parentId" | "isActive">[],
  input: { categoryId: string | null; previousCategoryId?: string | null; expectedParentId?: string | null },
): CategoryChoiceError | null {
  if (!input.categoryId) return null;
  const unchanged = input.previousCategoryId !== undefined && input.previousCategoryId === input.categoryId;
  const category = rows.find((row) => row.id === input.categoryId);
  if (!category) return "NOT_FOUND";
  if (unchanged) return null;
  if (!category.isActive) return "INACTIVE";
  if (category.parentId !== null) {
    const parent = rows.find((row) => row.id === category.parentId);
    if (!parent || !parent.isActive) return "PARENT_INACTIVE";
    if (input.expectedParentId && input.expectedParentId !== category.parentId) return "PARENT_MISMATCH";
    return null;
  }
  if (input.expectedParentId && input.expectedParentId !== category.id) return "PARENT_MISMATCH";
  if (rows.some((row) => row.parentId === category.id && row.isActive)) return "SUBCATEGORY_REQUIRED";
  return null;
}

/** Splits "Üst > Alt" (also "Üst / Alt" is NOT accepted: slashes appear in real names). */
export function parseCategoryPath(value: string): [string] | [string, string] | null {
  const parts = value.split(">").map((part) => part.trim());
  if (parts.some((part) => !part)) return null;
  if (parts.length === 1) return [parts[0]];
  if (parts.length === 2) return [parts[0], parts[1]];
  return null;
}
