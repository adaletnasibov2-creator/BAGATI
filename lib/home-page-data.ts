/**
 * Home page data (SCALE-FIX-2 B3): banners, featured/popular/new/discounted shelves, the campaign shelf, campaigns and
 * the stores strip, cached in this process for HOME_PAGE_CACHE_TTL_MS per city.
 *
 * Before: about 15 Prisma calls (about 60 SQL statements in 5 waves) on every home visit; home was the slowest page in
 * the SCALE-1 load test. The queries, filters, order and eligibility rules below are the ones the page ran before.
 *
 * What is NOT in the cache:
 *   - anything per visitor: the home page reads no session, cookie or header. The signed-in header lives in the
 *     layout and favourites live in the browser, so the cached value is the same for every visitor of a city;
 *   - site settings and the category tree: they have their own 30 s caches, invalidated when they are saved;
 *   - prices of the regular shelves: the page computes them at render time from the cached rows (a campaign that ends
 *     stops applying at once). The "Kampaniyada" shelf keeps its price from the load time (at most one TTL old).
 *
 * Freshness: an admin banner or homepage-selection save calls invalidateHomePageCache(), so this process shows it on
 * the next request. Other changes (products, stock, stores, campaigns, banner start/end times) show within the TTL.
 * Same multi-process note as lib/public-category-tree.ts: with several app processes, an invalidation reaches only
 * the process that handled the save; the others catch up within the TTL.
 *
 * Fallback: if the cache layer itself fails, the page reads straight from the database, as before. A failing database
 * read is not retried here (it surfaces as before, through the error page), so an outage does not double the load.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { createKeyedTtlCache, type KeyedTtlCache } from "@/lib/keyed-ttl-cache";
import { publicProductVisibilityWhere, publicStoreVisibilityWhere } from "@/lib/store-visibility";
import { selectHomepageCampaignProducts, type HomepageCampaign, type SelectedHomepageCampaignProduct } from "@/lib/homepage-campaign-products";
import { findHomepageCampaignProductBatches } from "@/lib/homepage-campaign-query";
import { resolvePublicStoreEligibility } from "@/lib/store-eligibility";
import { productCardPromotionLinks, productCardScalarSelect, productCardStoreNameSelect } from "@/lib/product-card-select";

export const HOME_PAGE_CACHE_TTL_MS = 30_000;
/** Keys are active city ids (the slug is resolved against the active city list first), so this is never reached. */
export const HOME_PAGE_CACHE_MAX_KEYS = 32;

export type HomeCity = { id: string; name: string; slug: string };
export type HomeStore = {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  city: { name: string };
};
export type HomeProduct = {
  id: string;
  storeId: string;
  name: string;
  price: Prisma.Decimal;
  discountPrice: Prisma.Decimal | null;
  images: string[];
  store: { id: string; name: string };
  promotionProducts: { promotion: { id: string; storeId: string | null; name: string; startsAt: Date; endsAt: Date; isActive: boolean; discountType: string | null; discountValue: Prisma.Decimal | null } }[];
  inventory: { variantId?: string | null; quantity: number; reserved: number; lowStockThreshold: number }[];
  variants: { isActive: boolean; inventory: { quantity: number; reserved: number; lowStockThreshold: number }[] }[];
};
export type HomeBanner = { id: string; title: string; description: string; imageUrl: string; buttonLabel: string; href: string; startsAt: Date; endsAt: Date; isActive: boolean; sortOrder: number };
type PopularOrderRow = { productId: string; _sum: { quantity: number | null } };

export type HomePageData = {
  banners: HomeBanner[];
  featuredProducts: HomeProduct[];
  popular: HomeProduct[];
  newestVisible: HomeProduct[];
  promotionalById: Map<string, SelectedHomepageCampaignProduct>;
  discounted: HomeProduct[];
  eligibleCampaigns: HomepageCampaign[];
  homepageStores: HomeStore[];
  /** True when the stores strip shows the admin's selection (heading "Seçilmiş mağazalar"). */
  storesAreFeatured: boolean;
  hasHomepageContent: boolean;
};

export function availableStock(inventory: HomeProduct["inventory"], variants: { inventory: HomeProduct["inventory"] }[] = []) {
  const rows = variants.length ? variants.flatMap((variant) => variant.inventory) : inventory.filter((row) => row.variantId == null);
  return rows.reduce((total, row) => total + Math.max(0, row.quantity - row.reserved), 0);
}

/**
 * A home shelf card (SCALE-FIX-2 A5): the card's columns only, the store's name and id (no PRO badge on home), stock
 * rows with the low-stock threshold, and only promotions that are on and not ended (lib/product-card-select.ts).
 */
export function homeProductCardSelect(now: Date) {
  return {
    ...productCardScalarSelect,
    store: { select: productCardStoreNameSelect },
    inventory: { select: { variantId: true, quantity: true, reserved: true, lowStockThreshold: true } },
    variants: { where: { isActive: true }, select: { isActive: true, inventory: { select: { quantity: true, reserved: true, lowStockThreshold: true } } } },
    promotionProducts: productCardPromotionLinks(now),
  } satisfies Prisma.ProductSelect;
}

/** The database reads the home page ran on every request before B3 (same filters, order and limits). */
export async function loadHomePageData(db: PrismaClient, city: HomeCity | null, now: Date): Promise<HomePageData> {
  const cityStoreFilter = city ? { cityId: city.id } : { cityId: "__no_active_city__" };
  const storeFilter = { ...publicStoreVisibilityWhere(), ...cityStoreFilter };
  const productFilter = publicProductVisibilityWhere(storeFilter);

  const [stores, newest, popularRows, discountCandidates, campaigns, promotionalCampaigns, banners, featuredProductLinks, featuredStoreLinks] = await Promise.all([
    db.store.findMany({
      where: storeFilter,
      take: 4,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        logoUrl: true,
        latitude: true,
        longitude: true,
        city: { select: { name: true } },
      },
    }),
    db.product.findMany({
      where: productFilter,
      take: 10,
      orderBy: { createdAt: "desc" },
      select: homeProductCardSelect(now),
    }),
    db.orderItem.groupBy({
      by: ["productId"],
      where: { storeOrder: { status: "DELIVERED", store: storeFilter } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    }),
    db.product.findMany({
      where: { ...productFilter, discountPrice: { not: null } },
      take: 40,
      // id breaks createdAt ties (bulk-created products share a timestamp), so the shelf is the same on every request.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: homeProductCardSelect(now),
    }),
    db.promotion.findMany({
      where: {
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
        OR: [{ storeId: null }, { store: storeFilter }],
      },
      select: {
        id: true,
        storeId: true,
        name: true,
        startsAt: true,
        endsAt: true,
        isActive: true,
        discountType: true,
        discountValue: true,
        store: { select: { name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } },
      },
      orderBy: { endsAt: "asc" },
      take: 4,
    }),
    db.promotion.findMany({
      where: {
        storeId: { not: null }, isActive: true, startsAt: { lte: now }, endsAt: { gte: now }, store: storeFilter,
        products: { some: { product: { status: "ACTIVE", store: storeFilter, OR: [
          { variants: { none: { isActive: true } }, inventory: { some: { variantId: null, quantity: { gt: db.inventory.fields.reserved } } } },
          { variants: { some: { isActive: true, inventory: { some: { quantity: { gt: db.inventory.fields.reserved } } } } } },
        ] } } },
      },
      select: { id: true, storeId: true, name: true, startsAt: true, endsAt: true, isActive: true, discountType: true, discountValue: true, store: { select: { name: true } } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: 8,
    }),
    db.homeBanner.findMany({
      where: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: 8,
    }),
    db.homepageFeaturedProduct.findMany({ orderBy: { position: "asc" }, select: { productId: true }, take: 12 }),
    db.homepageFeaturedStore.findMany({ orderBy: { position: "asc" }, select: { storeId: true }, take: 12 }),
  ]) as [HomeStore[], HomeProduct[], PopularOrderRow[], HomeProduct[], HomepageCampaign[], HomepageCampaign[], HomeBanner[], { productId: string }[], { storeId: string }[]];

  // One query for all campaigns (was one per campaign); first 10 per campaign, same filter and order.
  const campaignProductsByPromotion = await findHomepageCampaignProductBatches(db, promotionalCampaigns, storeFilter, 10);

  const featuredProductIds = featuredProductLinks.map((item) => item.productId);
  const featuredStoreIds = featuredStoreLinks.map((item) => item.storeId);

  const [popularProductsResult, featuredProductsResult, selectedStores] = await Promise.all([
    popularRows.length
      ? db.product.findMany({
        where: { ...productFilter, id: { in: popularRows.map((row) => row.productId) } },
        select: homeProductCardSelect(now),
      })
      : Promise.resolve([]),
    featuredProductIds.length
      ? db.product.findMany({
          where: { ...productFilter, id: { in: featuredProductIds } },
          select: homeProductCardSelect(now),
        })
      : Promise.resolve([]),
    featuredStoreIds.length
      ? db.store.findMany({
          where: { ...storeFilter, id: { in: featuredStoreIds } },
          select: { id: true, name: true, description: true, logoUrl: true, latitude: true, longitude: true, city: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);
  const homepageEligibilityStoreIds = await resolvePublicStoreEligibility([
    ...stores.map((store) => store.id),
    ...newest.map((product) => product.storeId),
    ...discountCandidates.map((product) => product.storeId),
    ...(popularProductsResult as HomeProduct[]).map((product) => product.storeId),
    ...(featuredProductsResult as HomeProduct[]).map((product) => product.storeId),
    ...selectedStores.map((store) => store.id),
    ...campaigns.flatMap((campaign) => campaign.storeId ? [campaign.storeId] : []),
    ...promotionalCampaigns.flatMap((campaign) => campaign.storeId ? [campaign.storeId] : []),
    ...campaignProductsByPromotion.flatMap((batch) => batch.map((row) => row.product.storeId)),
  ], db, now);
  const eligibleStores = stores.filter((store) => homepageEligibilityStoreIds.has(store.id));
  const eligibleNewest = newest.filter((product) => homepageEligibilityStoreIds.has(product.storeId));
  const eligibleDiscountCandidates = discountCandidates.filter((product) => homepageEligibilityStoreIds.has(product.storeId));
  const eligibleCampaigns = campaigns.filter((campaign) => !campaign.storeId || homepageEligibilityStoreIds.has(campaign.storeId));
  const eligiblePromotionalCampaignEntries = promotionalCampaigns.flatMap((campaign, index) =>
    campaign.storeId && homepageEligibilityStoreIds.has(campaign.storeId)
      ? [{
        campaign,
        products: campaignProductsByPromotion[index].filter((row) => homepageEligibilityStoreIds.has(row.product.storeId)),
      }]
      : [],
  );
  const popularProducts = (popularProductsResult as HomeProduct[]).filter((product) => homepageEligibilityStoreIds.has(product.storeId));
  const featuredProductsById = (featuredProductsResult as HomeProduct[]).filter((product) => homepageEligibilityStoreIds.has(product.storeId));
  const eligibleSelectedStores = selectedStores.filter((store) => homepageEligibilityStoreIds.has(store.id));
  const popularById = new Map(popularProducts.map((product) => [product.id, product]));
  const featuredProductsByIdMap = new Map(featuredProductsById.map((product) => [product.id, product]));
  const featuredProducts = featuredProductIds.flatMap((id) => {
    const product = featuredProductsByIdMap.get(id);
    return product ? [product] : [];
  });
  const selectedStoresById = new Map(eligibleSelectedStores.map((store) => [store.id, store]));
  const featuredStores = featuredStoreIds.flatMap((id) => {
    const store = selectedStoresById.get(id);
    return store ? [store] : [];
  });
  const homepageStores = featuredStores.length ? featuredStores : eligibleStores;
  const promotionalById = selectHomepageCampaignProducts(
    eligiblePromotionalCampaignEntries.map(({ campaign }) => campaign),
    eligiblePromotionalCampaignEntries.map(({ products }) => products.map((row) => row.product)),
    now,
    10,
  );
  const promotedIds = new Set(promotionalById.keys());
  const popular = popularRows.flatMap((row) => {
    const product = popularById.get(row.productId);
    return product && !promotedIds.has(product.id) && !featuredProductIds.includes(product.id) ? [product] : [];
  });
  const newestVisible = eligibleNewest.filter((product) => !promotedIds.has(product.id));
  const discounted = eligibleDiscountCandidates
    .filter(
      (product) =>
        product.discountPrice !== null &&
        Number(product.discountPrice) > 0 &&
        Number(product.discountPrice) < Number(product.price) &&
        !promotedIds.has(product.id),
    )
    .slice(0, 10);
  const hasHomepageContent = homepageStores.length > 0
    || featuredProducts.length > 0
    || popular.length > 0
    || newestVisible.length > 0
    || discounted.length > 0
    || promotionalById.size > 0
    || eligibleCampaigns.length > 0;

  return {
    banners,
    featuredProducts,
    popular,
    newestVisible,
    promotionalById,
    discounted,
    eligibleCampaigns,
    homepageStores,
    storesAreFeatured: featuredStores.length > 0,
    hasHomepageContent,
  };
}

/** Cache key: the resolved active city id; "" when there is no active city. Never the raw ?city= value. */
export function homePageCacheKey(city: HomeCity | null): string {
  return city?.id ?? "";
}

export type HomePageDataReaderDeps = {
  load: (city: HomeCity | null, now: Date) => Promise<HomePageData>;
  clock?: () => number;
  log?: (line: string) => void;
  /** Tests only: a cache to use instead of a new one. */
  cache?: KeyedTtlCache<string, HomePageData>;
};

export function createHomePageDataReader(deps: HomePageDataReaderDeps) {
  const clock = deps.clock ?? Date.now;
  const log = deps.log ?? ((line: string) => console.error(line));
  const cache = deps.cache ?? createKeyedTtlCache<string, HomePageData>({ ttlMs: HOME_PAGE_CACHE_TTL_MS, maxKeys: HOME_PAGE_CACHE_MAX_KEYS, clock });
  // Errors thrown by the database read itself (as opposed to the cache layer).
  const loadErrors = new WeakSet<object>();
  const load = (city: HomeCity | null) => async () => {
    try {
      return await deps.load(city, new Date(clock()));
    } catch (error) {
      if (error && typeof error === "object") loadErrors.add(error);
      throw error;
    }
  };
  return {
    async read(city: HomeCity | null): Promise<HomePageData> {
      try {
        return await cache.get(homePageCacheKey(city), load(city));
      } catch (error) {
        if (error && typeof error === "object" && loadErrors.has(error)) throw error;
        const name = error instanceof Error ? error.name : "unknown";
        log(JSON.stringify({ event: "home_page_cache.failed", error: name }));
        return deps.load(city, new Date(clock()));
      }
    },
    invalidate: () => cache.invalidate(),
    size: () => cache.size(),
  };
}

/** Kept on globalThis so route handlers and pages share one instance even if the bundler duplicates this module. */
const globalForHomeCache = globalThis as unknown as { bagatiHomePageReader?: ReturnType<typeof createHomePageDataReader> };
function homePageReader() {
  return globalForHomeCache.bagatiHomePageReader ??= createHomePageDataReader({
    load: async (city, now) => {
      const { prisma } = await import("@/lib/prisma");
      return loadHomePageData(prisma, city, now);
    },
  });
}

export function getHomePageData(city: HomeCity | null): Promise<HomePageData> {
  return homePageReader().read(city);
}

/** Call after a committed admin save of home banners or the homepage selections. */
export function invalidateHomePageCache(): void {
  homePageReader().invalidate();
}
