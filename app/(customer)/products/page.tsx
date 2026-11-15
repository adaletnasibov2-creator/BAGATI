import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { createPrismaPublicProductCatalogClient, decodeProductCatalogCursor, findPublicProductCatalogPage } from "@/lib/public-product-catalog";
import { createPrismaPublicStoreDiscoveryClient, findPublicStoreDiscoveryCursorPage } from "@/lib/public-store-discovery";
import { publicStoreListingWhere } from "@/lib/store-visibility";
import { StoreFilterSelect } from "@/components/store-filter-select";
import { ProductCard } from "@/components/product-card";
import { EmptyState } from "@/components/state-panel";
import { calculateEffectivePrice, productPromotions } from "@/lib/promotion-pricing";
import { normalizeProductCatalogSort } from "@/lib/catalog-sort";
import { getPublicCategoryData } from "@/lib/public-category-tree";
import { categoryBreadcrumbs, findCategoryBySlug } from "@/lib/category-tree";
import { categoryPageMetadata } from "@/lib/category-seo";
import { CategoryFilterTree } from "@/components/category-filter-tree";
import { CategoryBreadcrumbs } from "@/components/category-breadcrumbs";
import type { Metadata } from "next";
import { normalizePublicSearchTerm, PRODUCT_SEARCH_MAX_LENGTH } from "@/lib/search-term";
import { resolvePublicStoreEligibility } from "@/lib/store-eligibility";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ q?: string; city?: string; category?: string; store?: string; sort?: string; cursor?: string }> };

/** Category pages (?category=<slug>) get their own title, description, canonical and noindex when empty. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  if (!params.category) return { title: "Məhsullar" };
  const data = await getPublicCategoryData();
  const found = findCategoryBySlug(data.rows, params.category);
  const visibleCount = found ? data.tree.flatMap((top) => [top, ...top.children]).find((node) => node.id === found.category.id)?.count ?? 0 : 0;
  return categoryPageMetadata({ category: found?.category ?? null, parent: found?.parent ?? null, visibleCount });
}
export default async function ProductsPage({ searchParams }: Props) {
  const params = await searchParams;
  const now = new Date();
  const search = normalizePublicSearchTerm(params.q, PRODUCT_SEARCH_MAX_LENGTH);
  const searchQuery = search.value;
  const sort = normalizeProductCatalogSort(params.sort);
  const productInclude = {
    store: { select: { id: true, name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } },
    inventory: { select: { variantId: true, quantity: true, reserved: true } },
    variants: { where: { isActive: true }, select: { id: true, inventory: { select: { quantity: true, reserved: true } } } },
    promotionProducts: { include: { promotion: true } },
  } satisfies Prisma.ProductInclude;
  const decodedCursor = params.cursor ? decodeProductCatalogCursor(params.cursor) : null;
  const cursor = decodedCursor?.cursor.sort === sort ? params.cursor : undefined;
  const invalidCursor = Boolean(params.cursor && !cursor);
  const [categoryData, storePage, selectedStore, products] = await Promise.all([
    getPublicCategoryData(params.city || null),
    prisma.$transaction((tx) => findPublicStoreDiscoveryCursorPage(
      createPrismaPublicStoreDiscoveryClient(tx), { citySlug: params.city }, { pageSize: 20 },
    ), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }),
    params.store ? prisma.store.findFirst({
      where: { id: params.store, ...publicStoreListingWhere({ citySlug: params.city }, now) },
      select: { id: true, name: true },
    }) : Promise.resolve(null),
    prisma.$transaction(
      (tx) => findPublicProductCatalogPage(
        createPrismaPublicProductCatalogClient(tx, productInclude),
        {
          citySlug: params.city,
          storeId: params.store,
          categorySlug: params.category,
          query: searchQuery,
          searchFields: "catalog",
        }, { sort, now, limit: 48, paginate: true, ...(cursor ? { cursor } : {}) },
      ),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    ),
  ]);
  const eligibleSelectedStoreIds = selectedStore
    ? await resolvePublicStoreEligibility([selectedStore.id], prisma, now)
    : new Set<string>();
  const visibleSelectedStore = selectedStore && eligibleSelectedStoreIds.has(selectedStore.id) ? selectedStore : null;
  const selectedCategory = findCategoryBySlug(categoryData.rows, params.category);
  const storeOptions = storePage.items.map(({ id, name }) => ({ id, name }));
  if (visibleSelectedStore && !storeOptions.some(({ id }) => id === visibleSelectedStore.id)) storeOptions.unshift(visibleSelectedStore);
  const catalogHref = (value: string | null) => {
    const query = new URLSearchParams();
    if (searchQuery) query.set("q", searchQuery);
    if (params.city) query.set("city", params.city);
    if (params.category) query.set("category", params.category);
    if (params.store) query.set("store", params.store);
    if (sort !== "newest") query.set("sort", sort);
    if (value) query.set("cursor", value);
    return `/products${query.size ? `?${query.toString()}` : ""}`;
  };
  // Filter links keep search, city, store and sort, drop the cursor, and change only the category.
  const categoryFilterHref = (slug: string | null) => {
    const query = new URLSearchParams();
    if (slug) query.set("category", slug);
    if (searchQuery) query.set("q", searchQuery);
    if (params.city) query.set("city", params.city);
    if (params.store) query.set("store", params.store);
    if (sort !== "newest") query.set("sort", sort);
    return `/products${query.size ? `?${query.toString()}` : ""}`;
  };
  const filterTree = <CategoryFilterTree tree={categoryData.tree} selectedSlug={selectedCategory ? selectedCategory.category.slug : null} href={categoryFilterHref} />;
  return <div className="container py-10 md:py-14">
    {selectedCategory && <CategoryBreadcrumbs crumbs={categoryBreadcrumbs(selectedCategory.category, selectedCategory.parent)} className="mb-4" />}
    <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald">BAGATI kataloqu</p><h1 className="mt-2 text-3xl font-semibold text-ink md:text-4xl">{searchQuery ? `“${searchQuery}” üçün nəticələr` : selectedCategory ? selectedCategory.category.name : "Məhsullar"}</h1>
    {search.tooLong && <p role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{"Axtar\u0131\u015f s\u00f6z\u00fc " + PRODUCT_SEARCH_MAX_LENGTH + " simvoldan uzun ola bilm\u0259z. Q\u0131sa axtar\u0131\u015f daxil edin."}</p>}
    {invalidCursor && <p role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Səhifə keçidi etibarsızdır. İlk səhifə göstərilir.</p>}
    <form action="/products" className="mt-7 grid gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
      <input name="q" maxLength={PRODUCT_SEARCH_MAX_LENGTH} defaultValue={searchQuery} placeholder="Məhsul axtar" className="rounded-xl border border-line bg-paper px-4 py-3 text-sm outline-none focus:border-emerald" aria-label="Məhsul axtar"/>
      {params.category ? <p className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-line bg-paper px-4 text-sm"><input type="hidden" name="category" value={params.category}/><span className="min-w-0 truncate">Kateqoriya: <b>{selectedCategory?.category.name ?? params.category}</b></span><Link href={categoryFilterHref(null)} aria-label="Kateqoriya filtrini sil" className="ml-auto shrink-0 text-muted hover:text-ink">×</Link></p> : <span className="hidden lg:block" aria-hidden="true"/>}
      <StoreFilterSelect initialOptions={storeOptions} initialSelected={visibleSelectedStore?.id ?? ""} city={params.city ?? ""} />
      <select name="sort" defaultValue={sort} aria-label="Məhsulları sırala" className="rounded-xl border border-line bg-white px-4 py-3 text-sm"><option value="newest">Ən yenilər</option><option value="name">Ad: A–Z</option></select>
      {params.city && <input type="hidden" name="city" value={params.city}/>}<button className="rounded-xl bg-ink px-5 py-3 text-sm font-medium text-white hover:bg-emerald">Axtar və filtrlə</button>
    </form>
    <details className="mt-5 lg:hidden">
      <summary className="flex min-h-11 cursor-pointer items-center rounded-xl border border-line bg-white px-4 text-sm font-medium">Kateqoriyalar{selectedCategory ? `: ${selectedCategory.category.name}` : ""}</summary>
      <div className="mt-2">{filterTree}</div>
    </details>
    <div className="lg:mt-8 lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-6">
    <aside className="hidden lg:block">{filterTree}</aside>
    <div className="min-w-0">
    {products.items.length ? <>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:mt-0 lg:grid-cols-3 xl:grid-cols-4">{products.items.map((product) => {
      const effective = calculateEffectivePrice(
        product.price,
        product.discountPrice,
        productPromotions(product.promotionProducts, product.store.id),
        now,
      );
      const discounted = effective.unitPrice.lt(effective.basePrice);
      const stockRows = product.variants.length
        ? product.variants.flatMap((variant) => variant.inventory)
        : product.inventory.filter((row) => row.variantId === null);
      const stock = stockRows.reduce((sum, row) => sum + row.quantity - row.reserved, 0);
      const variantCount = product.variants.filter((variant) =>
        variant.inventory.some((row) => row.quantity > row.reserved),
      ).length || undefined;
      return <ProductCard
        key={product.id}
        id={product.id}
        name={product.name}
        price={effective.unitPrice.toFixed(2)}
        originalPrice={discounted ? effective.basePrice.toFixed(2) : null}
        store={product.store.name}
        storeHref={`/stores/${product.store.id}`}
        campaignName={effective.promotion?.name}
        image={product.images[0]}
        secondaryImage={product.images[1]}
        stock={stock}
        variantCount={variantCount}
      />;
      })}</div>
      <nav aria-label="Məhsul səhifələri" className="mt-7 flex flex-wrap justify-between gap-3">
        {products.hasPrevious && products.previousCursor ? <Link rel="prev" href={catalogHref(products.previousCursor)} className="min-h-11 rounded-xl border border-line bg-white px-4 py-3 text-sm font-medium">← Əvvəlki məhsullar</Link> : <span/>}
        {products.hasNext && products.nextCursor ? <Link rel="next" href={catalogHref(products.nextCursor)} className="min-h-11 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white">Daha çox məhsul →</Link> : <span className="self-center text-xs text-muted">Bütün uyğun məhsullar göstərildi</span>}
      </nav>
    </> : <div className="mt-8 lg:mt-0"><EmptyState title="Məhsul tapılmadı" detail="Axtarış və filtrləri dəyişərək yenidən yoxlayın."/>{products.hasPrevious && products.previousCursor && <Link rel="prev" href={catalogHref(products.previousCursor)} className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-line bg-white px-4 py-3 text-sm font-medium">← Əvvəlki məhsullar</Link>}{products.hasNext && products.nextCursor && <Link rel="next" href={catalogHref(products.nextCursor)} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white">{"N\u00f6vb\u0259ti n\u0259tic\u0259l\u0259ri yoxla \u2192"}</Link>}</div>}
    </div>
    </div>
  </div>;
}
