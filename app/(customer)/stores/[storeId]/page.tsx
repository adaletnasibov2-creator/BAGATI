import type { Metadata } from "next";
import { categoryScopeWhere } from "@/lib/category-where";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { PackageOpen, Search } from "lucide-react";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPublicStoreEligible } from "@/lib/store-eligibility";
import { publicProductVisibilityWhere, publicStoreByIdOrSlugWhere } from "@/lib/store-visibility";
import { activeComplimentaryEntitlementSelect } from "@/lib/subscription-entitlements";
import { isOwnedStoreAssetUrl } from "@/lib/storage/store-assets";
import { getStorefrontBrandingCompatibility } from "@/lib/storefront-branding-compat";
import { getSetting } from "@/lib/settings/read";
import { SETTING_KEYS } from "@/lib/settings/registry";
import { storeMetaDescription } from "@/lib/seo";
import { storeHoursOf } from "@/lib/store-hours";
import { getSiteSettings } from "@/lib/site-settings";
import { canonicalMetadata, shareImage, sharePreviewMetadata } from "@/lib/share-preview";
import { ProductGrid, type DisplayProduct } from "@/components/product-grid";
import { productCardScalarSelect, productCardStockSelect, productCardStoreSelect } from "@/lib/product-card-select";
import StorefrontBranding, { type StorefrontBrand } from "@/components/storefront-branding";
import { isSellerVoenVerified } from "@/lib/voen-verification";
import StorefrontContact from "@/components/storefront-contact";
import { messageEntryForViewer } from "@/lib/messaging-pages";
import { buildTelHref, buildWhatsAppUrl, normalizeAzPhone } from "@/lib/az-phone";
import { formatStoreAddress, openStreetMapUrl, safePublicMapUrl } from "@/lib/store-public-contact";
import { calculateEffectivePrice } from "@/lib/promotion-pricing";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";
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
  // STORE-HOURS: information only (line + dot in the header).
  openingTime: true,
  closingTime: true,
  // contactEmail is intentionally NOT selected: the store's email must never reach the public page or the browser.
  city: { select: { name: true, isActive: true } },
  vendor: {
    select: {
      sellerType: true,
      legalName: true,
      voen: true,
      legalAddress: true,
      user: { select: { id: true, isActive: true } },
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
    where: publicStoreByIdOrSlugWhere(storeId),
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
  // Not public (draft, suspended, unknown): nothing about the store in the head; the page itself is a 404.
  if (!store) return {};

  // The store's own description, else the seo.storeDescriptionTemplate setting with {store} replaced (max 160).
  const [template, settings, branding] = await Promise.all([
    getSetting<string>(SETTING_KEYS.seoStoreDescriptionTemplate),
    getSiteSettings(),
    getStorefrontBrandingCompatibility(store.id),
  ]);
  const description = storeMetaDescription({ template: template ?? "", storeName: store.name, storeDescription: store.description });
  // Share image: the banner, else the logo, only when the page itself shows it (same isOwnedStoreAssetUrl rule).
  const banner = branding?.bannerUrl && isOwnedStoreAssetUrl(store.id, branding.bannerUrl) ? branding.bannerUrl : null;
  const logo = store.logoUrl && isOwnedStoreAssetUrl(store.id, store.logoUrl) ? store.logoUrl : null;
  return {
    title: store.name,
    description,
    ...sharePreviewMetadata({ title: store.name, description, path: `/stores/${store.id}`, siteName: settings.siteName, image: shareImage([banner, logo], store.name) }),
    // SMALL-FIXES-1 C: rel=canonical = og:url (same /stores/{id} form, absolute from APP_BASE_URL).
    ...canonicalMetadata(`/stores/${store.id}`),
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
  // Logged-in customers with messaging ON get "Mağazaya yaz"; logged-out visitors keep the anonymous "Mesaj yaz" form.
  const messageHref = await messageEntryForViewer({ storeId: store.id }, "hide");

  const publicLogo = store.logoUrl && isOwnedStoreAssetUrl(store.id, store.logoUrl) ? store.logoUrl : null;
  const publicBanner = branding.bannerUrl && isOwnedStoreAssetUrl(store.id, branding.bannerUrl) ? branding.bannerUrl : null;
  const phone = normalizeAzPhone(store.contactPhone);
  const whatsappUrl = buildWhatsAppUrl(store.contactPhone, store.name);
  // "Təsdiqlənmiş satıcı" only when an admin verified the seller's current VÖEN (fails closed).
  const sellerVerified = await isSellerVoenVerified(prisma, { userId: store.vendor.user.id, voen: store.vendor.voen });
  const description = store.description?.trim() || null;
  const coordinates = store.latitude !== null && store.longitude !== null ? { latitude: store.latitude, longitude: store.longitude } : null;

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
    // A top-level slug includes its subcategories (same rule as /products).
    ...(category ? { category: categoryScopeWhere(category) } : {}),
    ...(query ? {
      OR: [
        { name: { contains: query, mode: "insensitive" as const } },
        { description: { contains: query, mode: "insensitive" as const } },
      ],
    } : {}),
  };

  const hasFilters = Boolean(query || category);
  const [categoryResult, catalogCount, unfilteredCount] = await Promise.all([
    prisma.product.findMany({
      where: { ...productWhere, categoryId: { not: null }, category: { isActive: true, OR: [{ parentId: null }, { parent: { is: { isActive: true } } }] } },
      select: { category: { select: { id: true, name: true, slug: true } } },
      distinct: ["categoryId"],
    }),
    prisma.product.count({ where: catalogWhere }),
    hasFilters ? prisma.product.count({ where: productWhere }) : Promise.resolve(null),
  ]);
  const storeProductCount = unfilteredCount ?? catalogCount;
  const totalPages = Math.max(1, Math.ceil(catalogCount / STOREFRONT_PAGE_SIZE));
  const currentPage = storefrontPageNumber(firstParam(search.page), totalPages);
  const skip = (currentPage - 1) * STOREFRONT_PAGE_SIZE;

  const [productResult, promotionResult] = await Promise.all([
    prisma.product.findMany({
      where: catalogWhere,
      // Only what the cards render (SCALE-FIX-2 A5), not full product rows.
      select: { ...productCardScalarSelect, store: { select: productCardStoreSelect }, ...productCardStockSelect },
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
            product: { select: { ...productCardScalarSelect, ...productCardStockSelect } },
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
  const hasNonDefaultSort = sort !== "newest";
  const hasCatalogSelection = hasFilters || hasNonDefaultSort;
  const filterParams = { q: query, category, sort };

  return <div className="container py-6 sm:py-9">
    <StorefrontBranding store={{
      id: store.id,
      name: store.name,
      logoUrl: publicLogo,
      bannerUrl: publicBanner,
      theme: branding.theme ?? "forest",
      cityName: store.city.name,
      whatsappUrl,
      sellerVerified,
      hasAbout: Boolean(description),
      productCount: storeProductCount,
      messageHref,
      description,
      address: formatStoreAddress(store.address, store.city.name),
      hours: storeHoursOf(store),
    } satisfies StorefrontBrand}/>

    {storeProductCount === 0
      ? <section id="store-products" className="mt-6 scroll-mt-6">
        <EmptyState
          className="border-dashed"
          icon={<PackageOpen size={26}/>}
          title="Mağaza hələ məhsul yayımlamayıb"
          description="Satıcı məhsullarını hazırlayır. Axtardığınız məhsul barədə soruşmaq istəyirsinizsə, satıcıya birbaşa yazın."
          action={<div className="flex flex-col justify-center gap-2 sm:flex-row">
            {whatsappUrl && <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={buttonClass({ size: "sm" })}>WhatsApp ilə yaz</a>}
            <a href={messageHref ?? "#store-message"} className={buttonClass({ variant: "secondary", size: "sm" })}>{messageHref ? "Mağazaya yaz" : "Mesaj yaz"}</a>
            <Link href="/stores" className={buttonClass({ variant: "ghost", size: "sm" })}>Digər mağazalara bax</Link>
          </div>}
        />
      </section>
      : <>
    {availableCategories.length > 0 && <nav id="store-categories" aria-label="Mağaza kateqoriyaları" className="mt-5 flex gap-2 overflow-x-auto pb-2 sm:flex-wrap sm:overflow-visible">
      <Link
        href={storefrontPageHref(store.id, 1, { ...filterParams, category: "" })}
        aria-current={!category ? "page" : undefined}
        className={`min-h-11 shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${!category ? "bg-primary text-white" : "border border-line-strong bg-white text-fg-secondary hover:border-primary hover:text-primary"}`}
      >Bütün məhsullar</Link>
      {availableCategories.map((item) => <Link
        key={item.id}
        href={storefrontPageHref(store.id, 1, { ...filterParams, category: item.slug })}
        aria-current={category === item.slug ? "page" : undefined}
        className={`min-h-11 shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${category === item.slug ? "bg-primary text-white" : "border border-line-strong bg-white text-fg-secondary hover:border-primary hover:text-primary"}`}
      >{item.name}</Link>)}
    </nav>}

    <section id="store-products" className="mt-6 scroll-mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-kicker uppercase text-gold-700">Mağazanın kataloqu</p>
          <h2 className="mt-1 font-display text-h2 text-fg">Məhsullar</h2>
          <p className="mt-1 text-sm text-fg-secondary">{catalogCount} {hasFilters ? "uyğun məhsul" : "yayımlanmış məhsul"}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <form action={`/stores/${store.id}`} className="flex min-w-0 flex-1 gap-2 sm:w-auto">
            {category && <input type="hidden" name="category" value={category}/>}
            {hasNonDefaultSort && <input type="hidden" name="sort" value={sort}/>}
            <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-line-strong bg-white px-4 transition-colors focus-within:border-primary focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus hover:border-primary sm:w-72">
              <Search size={17} aria-hidden="true" className="shrink-0 text-fg-muted"/>
              <input
                name="q"
                defaultValue={query}
                maxLength={MAX_STOREFRONT_SEARCH_LENGTH}
                aria-label={`${store.name} mağazasında axtar`}
                placeholder="Məhsul axtar"
                className="w-full bg-transparent py-2.5 text-sm text-fg outline-none placeholder:text-fg-muted"
              />
            </label>
            <button className={buttonClass({ size: "sm" })}>Axtar</button>
          </form>
          <form action={`/stores/${store.id}`} className="flex min-w-0 gap-2">
            {query && <input type="hidden" name="q" value={query}/>}
            {category && <input type="hidden" name="category" value={category}/>}
            <label htmlFor="store-product-sort" className="sr-only">Məhsulları çeşidlə</label>
            <select id="store-product-sort" name="sort" defaultValue={sort} className="min-h-11 min-w-0 flex-1 cursor-pointer rounded-full border border-line-strong bg-white px-4 text-sm text-fg transition-colors hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:w-48 sm:flex-none">
              <option value="newest">Ən yenilər</option>
              <option value="name">Ada görə</option>
            </select>
            <button className={buttonClass({ variant: "secondary", size: "sm" })}>Tətbiq et</button>
          </form>
        </div>
      </div>
      {queryTooLong && <p role="alert" className="mt-3 text-sm font-medium text-danger">Axtarış mətni 80 simvoldan uzun ola bilməz; ilk 80 simvol üzrə axtarılır.</p>}
      {hasCatalogSelection && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {query && <span className="rounded-full bg-primary-subtle px-3 py-1 text-fg-body">Axtarış: “{query}”</span>}
        {category && <span className="rounded-full bg-primary-subtle px-3 py-1 text-fg-body">Kateqoriya: {availableCategories.find((item) => item.slug === category)?.name ?? category}</span>}
        {hasNonDefaultSort && <span className="rounded-full bg-primary-subtle px-3 py-1 text-fg-body">Çeşidləmə: ada görə</span>}
        <Link href={`/stores/${store.id}#store-products`} className="inline-flex min-h-11 items-center rounded-sm font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Seçimləri sıfırla</Link>
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
        {currentPage > 1 && <Link href={storefrontPageHref(store.id, currentPage - 1, filterParams)} rel="prev" className={buttonClass({ variant: "secondary", size: "sm" })}>Əvvəlki</Link>}
        <span aria-current="page" className="inline-flex min-h-11 items-center rounded-full bg-primary px-4 text-sm font-semibold text-white">{currentPage} / {totalPages}</span>
        {currentPage < totalPages && <Link href={storefrontPageHref(store.id, currentPage + 1, filterParams)} rel="next" className={buttonClass({ variant: "secondary", size: "sm" })}>Növbəti</Link>}
      </nav>}
    </section>
    </>}

    <StorefrontContact info={{
      storeId: store.id,
      storeName: store.name,
      description,
      whatsappUrl,
      phoneDisplay: phone?.display ?? null,
      telHref: buildTelHref(store.contactPhone),
      address: formatStoreAddress(store.address, store.city.name),
      mapLink: safePublicMapUrl(store.mapUrl) ?? openStreetMapUrl(store.latitude, store.longitude),
      coordinates,
      messageHref,
    }}/>
    <div className="mt-8 text-right"><a href="#top" className="inline-flex min-h-11 items-center rounded-sm text-sm font-medium text-fg-secondary hover:text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Səhifənin əvvəlinə ↑</a></div>
  </div>;
}
