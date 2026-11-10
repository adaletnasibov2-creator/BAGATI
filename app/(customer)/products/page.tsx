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
import { categoriesWithOtherLast } from "@/lib/category-order";
import { normalizePublicSearchTerm, PRODUCT_SEARCH_MAX_LENGTH } from "@/lib/search-term";
import { resolvePublicStoreEligibility } from "@/lib/store-eligibility";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ q?: string; city?: string; category?: string; store?: string; sort?: string; cursor?: string }> };
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
  const [categoryRows, storePage, selectedStore, products] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } }),
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
  const categories = categoriesWithOtherLast(categoryRows as {id:string;name:string;slug:string}[]);
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
  return <div className="container py-10 md:py-14">
    <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald">BAGATI kataloqu</p><h1 className="mt-2 text-3xl font-semibold text-ink md:text-4xl">{searchQuery ? `“${searchQuery}” üçün nəticələr` : "Məhsullar"}</h1>
    {search.tooLong && <p role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{"Axtar\u0131\u015f s\u00f6z\u00fc " + PRODUCT_SEARCH_MAX_LENGTH + " simvoldan uzun ola bilm\u0259z. Q\u0131sa axtar\u0131\u015f daxil edin."}</p>}
    {invalidCursor && <p role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Səhifə keçidi etibarsızdır. İlk səhifə göstərilir.</p>}
    <form action="/products" className="mt-7 grid gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
      <input name="q" maxLength={PRODUCT_SEARCH_MAX_LENGTH} defaultValue={searchQuery} placeholder="Məhsul axtar" className="rounded-xl border border-line bg-paper px-4 py-3 text-sm outline-none focus:border-emerald" aria-label="Məhsul axtar"/>
      <select name="category" defaultValue={params.category ?? ""} className="rounded-xl border border-line bg-white px-4 py-3 text-sm"><option value="">Bütün kateqoriyalar</option>{categories.map(category => <option key={category.id} value={category.slug}>{category.name}</option>)}</select>
      <StoreFilterSelect initialOptions={storeOptions} initialSelected={visibleSelectedStore?.id ?? ""} city={params.city ?? ""} />
      <select name="sort" defaultValue={sort} aria-label="Məhsulları sırala" className="rounded-xl border border-line bg-white px-4 py-3 text-sm"><option value="newest">Ən yenilər</option><option value="name">Ad: A–Z</option></select>
      {params.city && <input type="hidden" name="city" value={params.city}/>}<button className="rounded-xl bg-ink px-5 py-3 text-sm font-medium text-white hover:bg-emerald">Axtar və filtrlə</button>
    </form>
    {products.items.length ? <>
      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">{products.items.map((product) => {
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
    </> : <div className="mt-8"><EmptyState title="Məhsul tapılmadı" detail="Axtarış və filtrləri dəyişərək yenidən yoxlayın."/>{products.hasPrevious && products.previousCursor && <Link rel="prev" href={catalogHref(products.previousCursor)} className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-line bg-white px-4 py-3 text-sm font-medium">← Əvvəlki məhsullar</Link>}{products.hasNext && products.nextCursor && <Link rel="next" href={catalogHref(products.nextCursor)} className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white">{"N\u00f6vb\u0259ti n\u0259tic\u0259l\u0259ri yoxla \u2192"}</Link>}</div>}
  </div>;
}
