/**
 * SEO-1: sitemap.xml entries.
 *
 * Eligibility is exactly the pages' own (shared helpers, no copied rules), so a URL here never answers 404:
 * - store page /stores/{id}: publicStoreEligibilityBaseWhere + isPublicStoreEligible (app/(customer)/stores/[storeId]);
 * - product page /products/{id}: publicProductVisibilityWhere + an eligible store (isPublicProductEligible), the same
 *   as app/(customer)/products/[productId]. Stock is not a page rule (an out-of-stock product page is 200), so it is
 *   not a sitemap rule either;
 * - category /products?category={slug}: the public tree of getPublicCategoryData() with a visible-product count > 0,
 *   the same numbers categoryPageMetadata uses for index/noindex (empty or hidden categories are noindex);
 * - home and the static info pages that declare their own canonical and index: true (no database).
 *
 * Cost: one store query and one product query (+ the 30 s category cache) at most once per hour per process
 * (createFailSafeLoader). A failing read serves the last good list, else only the static pages, and retries after
 * 60 s; the sitemap never answers 500.
 */
import type { MetadataRoute } from "next";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { absoluteSiteUrl } from "@/lib/category-seo";
import { categoryHref } from "@/lib/category-tree";
import { createFailSafeLoader } from "@/lib/fail-safe-cache";
import { getPublicCategoryData, type PublicCategoryNode } from "@/lib/public-category-tree";
import { isPublicProductEligible, isPublicStoreEligible } from "@/lib/public-store-eligibility";
import { publicStoreEligibilityBaseWhere } from "@/lib/seller-legal-policy";
import { publicProductVisibilityWhere } from "@/lib/store-visibility";
import { activeComplimentaryEntitlementSelect } from "@/lib/subscription-entitlements";

/** Protocol limit per sitemap file (50,000 URLs, 50 MB). One entry is < 200 bytes, so 50,000 stay under 10 MB. */
export const SITEMAP_MAX_URLS = 50_000;
export const SITEMAP_TTL_MS = 60 * 60 * 1000;
export const SITEMAP_RETRY_AFTER_MS = 60 * 1000;

/**
 * Public pages that set their own canonical and robots index: true (no database read for the sitemap itself).
 * SEO-TITLES-1: + the listing and info pages /stores, /deals, /new-products, /delivery-returns, /help, /categories.
 */
export const SITEMAP_STATIC_PATHS = ["/", "/about", "/contact", "/terms", "/privacy", "/seller-terms", "/stores", "/deals", "/new-products", "/delivery-returns", "/help", "/categories"] as const;

export type SitemapEntry = { path: string; lastModified?: Date };

/** The fields isPublicStoreEligible reads (PublicStoreCandidate) plus updatedAt. */
export const sitemapStoreSelect = {
  id: true,
  updatedAt: true,
  status: true,
  isActive: true,
  legalInfoApproved: true,
  adminManaged: true,
  city: { select: { isActive: true } },
  vendor: { select: { sellerType: true, legalName: true, voen: true, legalAddress: true, user: { select: { isActive: true } } } },
  subscription: { select: { status: true, currentPeriodStart: true, currentPeriodEnd: true, plan: { select: { isActive: true, slug: true } } } },
  complimentaryEntitlements: activeComplimentaryEntitlementSelect,
} satisfies Prisma.StoreSelect;

export type SitemapStoreRow = Prisma.StoreGetPayload<{ select: typeof sitemapStoreSelect }>;
export type SitemapProductRow = { id: string; storeId: string; status: string; updatedAt: Date };

export type SitemapDeps = {
  loadStores: (now: Date) => Promise<SitemapStoreRow[]>;
  loadProducts: (eligibleStoreIds: string[], now: Date, limit: number) => Promise<SitemapProductRow[]>;
  loadCategories: () => Promise<PublicCategoryNode[]>;
  now?: () => Date;
};

export function staticSitemapEntries(): SitemapEntry[] {
  return SITEMAP_STATIC_PATHS.map((path) => ({ path }));
}

/** Indexable public categories: every node of the public tree with at least one visible product (rolled-up count). */
export function categorySitemapEntries(tree: readonly PublicCategoryNode[]): SitemapEntry[] {
  return tree.flatMap((top) => [top, ...top.children]).filter((node) => node.count > 0).map((node) => ({ path: categoryHref(node.slug) }));
}

export async function buildSitemapEntries(deps: SitemapDeps): Promise<SitemapEntry[]> {
  const now = deps.now?.() ?? new Date();
  const [stores, tree] = await Promise.all([deps.loadStores(now), deps.loadCategories()]);
  const eligibleStores = stores.filter((store) => isPublicStoreEligible(store, now));
  const eligibleIds = new Set(eligibleStores.map((store) => store.id));
  const head = [...staticSitemapEntries(), ...categorySitemapEntries(tree)];
  const storeEntries = eligibleStores.map((store) => ({ path: `/stores/${store.id}`, lastModified: store.updatedAt }));
  const room = Math.max(0, SITEMAP_MAX_URLS - head.length - storeEntries.length);
  const products = eligibleIds.size && room ? await deps.loadProducts([...eligibleIds], now, room) : [];
  const productEntries = products
    .filter((product) => isPublicProductEligible(product, eligibleIds))
    .map((product) => ({ path: `/products/${product.id}`, lastModified: product.updatedAt }));
  return [...head, ...storeEntries, ...productEntries].slice(0, SITEMAP_MAX_URLS);
}

type SitemapDb = Pick<PrismaClient, "store" | "product">;

export function prismaSitemapDeps(db: SitemapDb = prisma): SitemapDeps {
  return {
    loadStores: (now) => db.store.findMany({ where: publicStoreEligibilityBaseWhere(now), select: sitemapStoreSelect, orderBy: { id: "asc" } }),
    loadProducts: (eligibleStoreIds, now, limit) => db.product.findMany({
      where: { AND: [publicProductVisibilityWhere(undefined, now), { storeId: { in: eligibleStoreIds } }] },
      select: { id: true, storeId: true, status: true, updatedAt: true },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: limit,
    }),
    loadCategories: async () => (await getPublicCategoryData()).tree,
  };
}

/** Absolute URLs from APP_BASE_URL; without a valid base there is nothing absolute to list, so the list is empty. */
export function toSitemapXmlEntries(entries: readonly SitemapEntry[], base: string | undefined = process.env.APP_BASE_URL): MetadataRoute.Sitemap {
  return entries.flatMap((entry) => {
    const url = absoluteSiteUrl(entry.path, base);
    return url ? [{ url, ...(entry.lastModified ? { lastModified: entry.lastModified } : {}) }] : [];
  });
}

export function createSitemapLoader(deps: SitemapDeps, options: { clock?: () => number; log?: (line: string) => void } = {}) {
  return createFailSafeLoader<SitemapEntry[]>({
    label: "sitemap",
    ttlMs: SITEMAP_TTL_MS,
    retryAfterMs: SITEMAP_RETRY_AFTER_MS,
    load: () => buildSitemapEntries(deps),
    fallback: staticSitemapEntries,
    clock: options.clock,
    log: options.log,
  });
}

/** One loader per process (globalThis, like the category cache), so every crawler request within the hour is memory only. */
const globalForSitemap = globalThis as unknown as { bagatiSitemapLoader?: ReturnType<typeof createSitemapLoader> };

export function getSitemapEntries(): Promise<SitemapEntry[]> {
  globalForSitemap.bagatiSitemapLoader ??= createSitemapLoader(prismaSitemapDeps());
  return globalForSitemap.bagatiSitemapLoader.get();
}
