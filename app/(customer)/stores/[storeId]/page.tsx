import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { Search } from "lucide-react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPublicStoreEligible } from "@/lib/store-eligibility";
import { publicProductVisibilityWhere } from "@/lib/store-visibility";
import { publicStoreEligibilityBaseWhere } from "@/lib/seller-legal-policy";
import { activeComplimentaryEntitlementSelect } from "@/lib/subscription-entitlements";
import { isOwnedStoreAssetUrl } from "@/lib/storage/store-assets";
import { getStorefrontBrandingCompatibility } from "@/lib/storefront-branding-compat";
import { ProductGrid, type DisplayProduct } from "@/components/product-grid";
import StorefrontBranding, { type StorefrontBrand } from "@/components/storefront-branding";
import { InteractiveMap } from "@/components/interactive-map";
import { calculateEffectivePrice } from "@/lib/promotion-pricing";
import { normalizeProductCatalogSort, productCatalogOrderBy } from "@/lib/catalog-sort";

export const dynamic = "force-dynamic";

const STOREFRONT_PAGE_SIZE = 24;
const MAX_STOREFRONT_SEARCH_LENGTH = 80;
const inStockProductWhere: Prisma.ProductWhereInput = {
  OR: [
    { inventory: { some: { variantId: null, quantity: { gt: 0 } } } },
    { variants: { some: { isActive: true, inventory: { some: { quantity: { gt: 0 } } } } } },
  ],
};

const storeSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  isActive: true,
  legalInfoApproved: true,
  adminManaged: true,
  description: true,
  logoUrl: true,
  address: true,
  mapUrl: true,
  latitude: true,
  longitude: true,
  contactPhone: true,
  contactEmail: true,
  city: { select: { name: true, isActive: true } },
  vendor: {
    select: {
      sellerType: true,
      legalName: true,
      voen: true,
      legalAddress: true,
      user: { select: { isActive: true } },
    },
  },
  subscription: {
    select: {
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      plan: { select: { isActive: true, slug: true } },
    },
  },
  complimentaryEntitlements: activeComplimentaryEntitlementSelect,
} satisfies Prisma.StoreSelect;

type PublicStore = Prisma.StoreGetPayload<{ select: typeof storeSelect }>;

const getPublicStore = cache(async (storeId: string): Promise<PublicStore | null> => {
  const store = await prisma.store.findFirst({
    where: {
      OR: [{ id: storeId }, { slug: storeId }],
      ...publicStoreEligibilityBaseWhere(),
    },
    select: storeSelect,
  });
  return store && isPublicStoreEligible(store) ? store : null;
});

type SearchParams = {
  q?: string | string[];
  category?: string | string[];
  sort?: string | string[];
  page?: string | string[];
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function storefrontPageNumber(value: string | undefined, totalPages: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, totalPages);
}

function storefrontPageHref(storeId: string, page: number, filters: { q: string; category: string; sort: string }) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.sort !== "newest") params.set("sort", filters.sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/stores/${storeId}${query ? `?${query}` : ""}#store-products`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ storeId: string }>;
}): Promise<Metadata> {
  const { storeId } = await params;
  const store = await getPublicStore(storeId);
  if (!store) return {};

  const description = store.description?.trim().slice(0, 160)
    || `Məhsulları ${store.name} mağazasından BAGATI marketplace-də kəşf edin.`;
  return {
    title: store.name,
    description,
    openGraph: {
      title: store.name,
      description,
      type: "website",
    },
  };
}

export default async function StorefrontPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ storeId }, search] = await Promise.all([params, searchParams]);
  const store = await getPublicStore(storeId);
  if (!store) notFound();

  const branding = await getStorefrontBrandingCompatibility(store.id);
  if (!branding) notFound();

  const publicLogo = store.logoUrl && isOwnedStoreAssetUrl(store.id, store.logoUrl) ? store.logoUrl : null;
  const publicBanner = branding.bannerUrl && isOwnedStoreAssetUrl(store.id, branding.bannerUrl) ? branding.bannerUrl : null;
  const publicStorefront: StorefrontBrand = {
    id: store.id,
    name: store.name,
    description: store.description,
    logoUrl: publicLogo,
    bannerUrl: publicBanner,
    theme: branding.theme ?? "forest",
    city: store.city,
    contactPhone: store.contactPhone,
    contactEmail: store.contactEmail,
  };

  const rawQuery = firstParam(search.q)?.trim() ?? "";
  const queryTooLong = rawQuery.length > MAX_STOREFRONT_SEARCH_LENGTH;
  const query = rawQuery.slice(0, MAX_STOREFRONT_SEARCH_LENGTH);
  const category = firstParam(search.category)?.trim() ?? "";
  const sort = normalizeProductCatalogSort(firstParam(search.sort));
  const now = new Date();
  const productWhere = {
    ...publicProductVisibilityWhere({ id: store.id }, now),
    storeId: store.id,
  };
  const catalogWhere = {
    ...productWhere,
    ...(category ? { category: { slug: category, isActive: true } } : {}),
    ...(query ? {
      OR: [
        { name: { contains: query, mode: "insensitive" as const } },
        { description: { contains: query, mode: "insensitive" as const } },
      ],
    } : {}),
  };

  const [categoryResult, catalogCount] = await Promise.all([
    prisma.product.findMany({
      where: { ...productWhere, categoryId: { not: null }, category: { isActive: true } },
      select: { category: { select: { id: true, name: true, slug: true } } },
      distinct: ["categoryId"],
    }),
    prisma.product.count({ where: catalogWhere }),
  ]);
  const totalPages = Math.max(1, Math.ceil(catalogCount / STOREFRONT_PAGE_SIZE));
  const currentPage = storefrontPageNumber(firstParam(search.page), totalPages);
  const skip = (currentPage - 1) * STOREFRONT_PAGE_SIZE;

  const [productResult, promotionResult] = await Promise.all([
    prisma.product.findMany({
      where: catalogWhere,
      include: {
        store: {
          select: {
            name: true,
            isActive: true,
            status: true,
            subscription: {
              select: {
                status: true,
                currentPeriodEnd: true,
                plan: { select: { slug: true, isActive: true } },
              },
            },
          },
        },
        inventory: { select: { variantId: true, quantity: true, reserved: true } },
        variants: {
          where: { isActive: true },
          select: { id: true, isActive: true, inventory: { select: { quantity: true, reserved: true } } },
        },
      },
      orderBy: productCatalogOrderBy(sort),
      skip,
      take: STOREFRONT_PAGE_SIZE,
    }),
    prisma.promotion.findMany({
      where: {
        storeId: store.id,
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
        products: { some: { product: { AND: [catalogWhere, inStockProductWhere] } } },
      },
      include: {
        products: {
          where: { product: { AND: [catalogWhere, inStockProductWhere] } },
          include: {
            product: {
              include: {
                inventory: { select: { variantId: true, quantity: true, reserved: true } },
                variants: {
                  where: { isActive: true },
                  select: { id: true, isActive: true, inventory: { select: { quantity: true, reserved: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: 12,
    }),
  ]);

  const categoryRows = categoryResult as { category: { id: string; name: string; slug: string } | null }[];
  const products = productResult as DisplayProduct[];
  const availableCategories = categoryRows
    .flatMap((row) => row.category ? [row.category] : [])
    .sort((left, right) => left.name.localeCompare(right.name, "az"));
  const pageProductIds = new Set(products.map((product) => product.id));
  const promoted = new Map<string, { effectivePrice: string; campaignName: string }>();
  for (const campaign of promotionResult) {
    for (const link of campaign.products) {
      const product = link.product;
      if (campaign.storeId !== store.id || !pageProductIds.has(product.id) || promoted.has(product.id)) continue;
      const stockRows = product.variants.length
        ? product.variants.flatMap((variant) => variant.inventory)
        : product.inventory.filter((row) => row.variantId === null);
      if (stockRows.reduce((sum, row) => sum + row.quantity - row.reserved, 0) <= 0) continue;
      const price = calculateEffectivePrice(product.price, product.discountPrice, [campaign], now);
      if (price.promotion) {
        promoted.set(product.id, { effectivePrice: price.unitPrice.toFixed(2), campaignName: campaign.name });
      }
    }
  }
  const storefrontProducts = products.map((product) => {
    const campaign = promoted.get(product.id);
    return campaign ? { ...product, ...campaign, storeId: store.id } : { ...product, storeId: store.id };
  });
  const hasFilters = Boolean(query || category);
  const hasNonDefaultSort = sort !== "newest";
  const hasCatalogSelection = hasFilters || hasNonDefaultSort;
  const filterParams = { q: query, category, sort };

  return <div className="container py-6 sm:py-9">
    <StorefrontBranding store={publicStorefront} categoryCount={availableCategories.length}/>

    {availableCategories.length > 0 && <nav id="store-categories" aria-label="Mağaza kateqoriyaları" className="mt-5 flex gap-2 overflow-x-auto pb-2 sm:flex-wrap sm:overflow-visible">
      <Link
        href={storefrontPageHref(store.id, 1, { ...filterParams, category: "" })}
        aria-current={!category ? "page" : undefined}
        className={`min-h-11 shrink-0 rounded-full px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52] ${!category ? "bg-ink text-white" : "border border-line bg-white text-muted hover:text-emerald"}`}
      >Bütün məhsullar</Link>
      {availableCategories.map((item) => <Link
        key={item.id}
        href={storefrontPageHref(store.id, 1, { ...filterParams, category: item.slug })}
        aria-current={category === item.slug ? "page" : undefined}
        className={`min-h-11 shrink-0 rounded-full px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52] ${category === item.slug ? "bg-ink text-white" : "border border-line bg-white text-muted hover:text-emerald"}`}
      >{item.name}</Link>)}
    </nav>}

    <section id="store-products" className="mt-7 scroll-mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">Mağazanın kataloqu</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">Məhsullar</h2>
          <p className="mt-1 text-sm text-muted">{catalogCount} {hasFilters ? "uyğun məhsul" : "yayımlanmış məhsul"}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <form action={`/stores/${store.id}`} className="flex min-w-0 flex-1 gap-2 sm:w-auto">
            {category && <input type="hidden" name="category" value={category}/>}
            {hasNonDefaultSort && <input type="hidden" name="sort" value={sort}/>}
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-white px-3 sm:w-72">
              <Search size={17} aria-hidden="true" className="shrink-0 text-muted"/>
              <input
                name="q"
                defaultValue={query}
                maxLength={MAX_STOREFRONT_SEARCH_LENGTH}
                aria-label={`${store.name} mağazasında axtar`}
                placeholder="Məhsul axtar"
                className="w-full py-3 text-sm outline-none"
              />
            </label>
            <button className="min-h-11 rounded-xl bg-ink px-4 text-sm font-medium text-white hover:bg-emerald focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]">Axtar</button>
          </form>
          <form action={`/stores/${store.id}`} className="flex min-w-0 gap-2">
            {query && <input type="hidden" name="q" value={query}/>}
            {category && <input type="hidden" name="category" value={category}/>}
            <label htmlFor="store-product-sort" className="sr-only">Məhsulları çeşidlə</label>
            <select id="store-product-sort" name="sort" defaultValue={sort} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-sm sm:w-48 sm:flex-none">
              <option value="newest">Ən yenilər</option>
              <option value="name">Ada görə</option>
            </select>
            <button className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm font-medium text-ink hover:border-[#93ADA0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]">Tətbiq et</button>
          </form>
        </div>
      </div>
      {queryTooLong && <p role="alert" className="mt-3 text-sm text-red-700">Axtarış mətni 80 simvoldan uzun ola bilməz; ilk 80 simvol üzrə axtarılır.</p>}
      {hasCatalogSelection && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {query && <span className="rounded-full bg-[#F0F4F0] px-3 py-1 text-[#52645D]">Axtarış: “{query}”</span>}
        {category && <span className="rounded-full bg-[#F0F4F0] px-3 py-1 text-[#52645D]">Kateqoriya: {availableCategories.find((item) => item.slug === category)?.name ?? category}</span>}
        {hasNonDefaultSort && <span className="rounded-full bg-[#F0F4F0] px-3 py-1 text-[#52645D]">Çeşidləmə: ada görə</span>}
        <Link href={`/stores/${store.id}#store-products`} className="inline-flex min-h-11 items-center font-medium text-emerald hover:underline">Seçimləri sıfırla</Link>
      </div>}
      <div className="mt-5">
        <ProductGrid
          products={storefrontProducts}
          emptyTitle={hasFilters ? "Uyğun məhsul tapılmadı" : "Hazırda yayımlanmış məhsul yoxdur"}
          emptyDetail={hasFilters
            ? "Axtarışı və ya kateqoriya seçimini dəyişərək yenidən yoxlayın."
            : "Mağaza yeni məhsullar əlavə etdikdə onlar burada görünəcək."}
        />
      </div>
      {totalPages > 1 && <nav aria-label="Məhsul səhifələri" className="mt-7 flex flex-wrap items-center justify-center gap-2">
        {currentPage > 1 && <Link href={storefrontPageHref(store.id, currentPage - 1, filterParams)} rel="prev" className="inline-flex min-h-11 items-center rounded-full border border-line bg-white px-4 text-sm font-medium text-ink hover:border-[#93ADA0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]">Əvvəlki</Link>}
        <span aria-current="page" className="inline-flex min-h-11 items-center rounded-full bg-[#173A3A] px-4 text-sm font-medium text-white">{currentPage} / {totalPages}</span>
        {currentPage < totalPages && <Link href={storefrontPageHref(store.id, currentPage + 1, filterParams)} rel="next" className="inline-flex min-h-11 items-center rounded-full border border-line bg-white px-4 text-sm font-medium text-ink hover:border-[#93ADA0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]">Növbəti</Link>}
      </nav>}
    </section>

    {store.description && <section id="store-about" className="mt-10 scroll-mt-6 rounded-2xl border border-line bg-white p-5 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">Mağaza haqqında</p>
      <h2 className="mt-1 text-xl font-semibold text-ink">{store.name}</h2>
      <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-7 text-muted">{store.description}</p>
    </section>}

    {(store.address || store.mapUrl || (store.latitude !== null && store.longitude !== null)) && <section className="mt-6 grid gap-4 rounded-2xl border border-line bg-white p-5 sm:grid-cols-[1fr_1.2fr] sm:p-6">
      <div>
        <h2 className="font-semibold text-ink">Mağaza ünvanı</h2>
        <p className="mt-2 text-sm text-muted">{[store.address, store.city.name].filter(Boolean).join(", ")}</p>
        {store.contactPhone && <a href={`tel:${store.contactPhone}`} className="mt-2 inline-flex min-h-11 items-center text-sm text-muted">Telefon: {store.contactPhone}</a>}
        {store.contactEmail && <a href={`mailto:${store.contactEmail}`} className="mt-1 inline-flex min-h-11 items-center text-sm text-muted">E-poçt: {store.contactEmail}</a>}
        {store.mapUrl && <a href={store.mapUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center text-sm text-emerald">Xəritədə aç →</a>}
        {store.latitude !== null && store.longitude !== null && <a href={`https://www.openstreetmap.org/?mlat=${store.latitude}&mlon=${store.longitude}#map=15/${store.latitude}/${store.longitude}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center text-sm text-emerald">Mövqeyi OpenStreetMap-də aç →</a>}
      </div>
      {store.latitude !== null && store.longitude !== null && <InteractiveMap selected={{ latitude: store.latitude, longitude: store.longitude }} className="h-56" zoom={14}/>}
    </section>}
    <div className="mt-8 text-right"><a href="#top" className="inline-flex min-h-11 items-center text-sm text-muted hover:underline">Səhifənin əvvəlinə ↑</a></div>
  </div>;
}
