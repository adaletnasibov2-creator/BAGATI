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
import { getSetting } from "@/lib/settings/read";
import { SETTING_KEYS } from "@/lib/settings/registry";
import { createKeyedTtlCache } from "@/lib/keyed-ttl-cache";

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

export function toPublicTree(rows: readonly CategoryRow[], counts: ReadonlyMap<string, number>, options: { showEmpty?: boolean } = {}): PublicCategoryNode[] {
  return publicCategoryTree(rows, counts, options).map((top) => ({
    id: top.id, name: top.name, slug: top.slug, parentId: null, iconKey: top.iconKey, imageUrl: top.imageUrl, parentIconKey: null, count: top.count,
    children: top.children.map((child) => ({
      id: child.id, name: child.name, slug: child.slug, parentId: top.id, iconKey: child.iconKey, imageUrl: child.imageUrl, parentIconKey: top.iconKey, count: child.count,
    })),
  }));
}

export type PublicCategoryData = { rows: CategoryRow[]; counts: Map<string, number>; showEmpty: boolean; tree: PublicCategoryNode[] };

export const PUBLIC_CATEGORY_CACHE_TTL_MS = 30_000;
export const PUBLIC_CATEGORY_CACHE_MAX_KEYS = 32;

/** undefined, null and "" all mean "every city" and share one cache key. Other values are used as given. */
export function normalizePublicCategoryCityKey(citySlug?: string | null): string | null {
  return citySlug || null;
}

type CachedCategoryBase = { rows: CategoryRow[]; counts: Map<string, number> };
export type PublicCategoryDataReaderDeps = {
  loadRows: () => Promise<CategoryRow[]>;
  loadCounts: (citySlug: string | null, now: Date) => Promise<Map<string, number>>;
  readShowEmptySetting: () => Promise<boolean | null>;
  clock?: () => number;
};

/**
 * Category rows and visible-product counts, cached across requests for 30 s per city key (at most 32 keys: the city
 * comes from the query string). catalog.showEmptyCategories is not part of the cached value: it is read on every call
 * through the settings cache, which is invalidated when the setting is saved. The tree is rebuilt per call.
 */
export function createPublicCategoryDataReader(deps: PublicCategoryDataReaderDeps) {
  const clock = deps.clock ?? Date.now;
  const shared = createKeyedTtlCache<string | null, CachedCategoryBase>({ ttlMs: PUBLIC_CATEGORY_CACHE_TTL_MS, maxKeys: PUBLIC_CATEGORY_CACHE_MAX_KEYS, clock });
  return {
    async read(citySlug?: string | null): Promise<PublicCategoryData> {
      const key = normalizePublicCategoryCityKey(citySlug);
      const [base, setting] = await Promise.all([
        shared.get(key, async () => {
          const now = new Date(clock());
          const [rows, counts] = await Promise.all([deps.loadRows(), deps.loadCounts(key, now)]);
          return { rows, counts };
        }),
        deps.readShowEmptySetting(),
      ]);
      // Each caller gets its own array and map; the cached ones are never handed out.
      const rows = [...base.rows];
      const counts = new Map(base.counts);
      const showEmpty = setting !== false; // null (no value) = the default, ON
      return { rows, counts, showEmpty, tree: toPublicTree(rows, counts, { showEmpty }) };
    },
    invalidate: () => shared.invalidate(),
    size: () => shared.size(),
  };
}

/**
 * Deployment assumption: BAGATI runs as ONE PM2 process (owner, 2026-11-16; not recorded in this repo). The cache lives
 * in that process's memory, so invalidatePublicCategoryCache() after an admin or seller write is seen by the next
 * request. If the app ever runs as more processes (PM2 cluster mode, several servers), each process has its own cache
 * and an invalidation reaches only the process that handled the write; the others catch up within the 30 s TTL. To keep
 * writes visible at once in that setup, move the invalidation (or the cache) to a shared channel such as Redis or
 * Postgres LISTEN/NOTIFY.
 *
 * Kept on globalThis so route handlers and pages share one instance even if the bundler duplicates this module.
 */
const globalForCategoryCache = globalThis as unknown as { bagatiPublicCategoryReader?: ReturnType<typeof createPublicCategoryDataReader> };
const publicCategoryReader = globalForCategoryCache.bagatiPublicCategoryReader ??= createPublicCategoryDataReader({
  loadRows: () => loadAllCategoryRows(),
  loadCounts: (citySlug, now) => countVisibleProductsByCategory(prisma, now, citySlug),
  readShowEmptySetting: () => getSetting<boolean>(SETTING_KEYS.catalogShowEmptyCategories),
});

/**
 * Call after a committed write that can change the public category tree or its counts: category create, edit,
 * activate/deactivate, delete or reorder; product create, status or category change. Other eligibility changes
 * (store, subscription, city, user) are picked up by the 30 s TTL.
 */
export function invalidatePublicCategoryCache(): void {
  publicCategoryReader.invalidate();
}

/** Per request (React cache, on the normalised key) on top of the 30 s cross-request cache. */
const getPublicCategoryDataForKey = cache((key: string | null) => publicCategoryReader.read(key));

export function getPublicCategoryData(citySlug?: string | null): Promise<PublicCategoryData> {
  return getPublicCategoryDataForKey(normalizePublicCategoryCityKey(citySlug));
}
