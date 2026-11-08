import Link from "next/link";
import { notFound } from "next/navigation";
import { Search } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { isPublicStoreEligible } from "@/lib/store-eligibility";
import { publicProductVisibilityWhere } from "@/lib/store-visibility";
import { publicStoreEligibilityBaseWhere } from "@/lib/seller-legal-policy";
import { isOwnedStoreAssetUrl } from "@/lib/storage/store-assets";
import { getStorefrontBrandingCompatibility } from "@/lib/storefront-branding-compat";
import { ProductGrid, type DisplayProduct } from "@/components/product-grid";
import StorefrontBranding, { type StorefrontBrand } from "@/components/storefront-branding";
import { InteractiveMap } from "@/components/interactive-map";
import { calculateEffectivePrice } from "@/lib/promotion-pricing";

export const dynamic = "force-dynamic";

export default async function StorefrontPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const [{ storeId }, filters] = await Promise.all([params, searchParams]);
  const store = await prisma.store.findFirst({
    where: { OR: [{ id: storeId }, { slug: storeId }], ...publicStoreEligibilityBaseWhere() },
    select: {
      id: true,
      name: true,
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
    },
  });
  if (!store || !isPublicStoreEligible(store)) notFound();

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

  const now = new Date();
  const productWhere = {
    ...publicProductVisibilityWhere({ id: store.id }),
    storeId: store.id,
  };
  const [categoryResult, productResult, promotionResult, publicProductCount] = await Promise.all([
    prisma.product.findMany({
      where: { ...productWhere, categoryId: { not: null }, category: { isActive: true } },
      select: { category: { select: { id: true, name: true, slug: true } } },
      distinct: ["categoryId"],
    }),
    prisma.product.findMany({
      where: {
        ...productWhere,
        ...(filters.category ? { category: { slug: filters.category, isActive: true } } : {}),
        ...(filters.q ? {
          OR: [
            { name: { contains: filters.q, mode: "insensitive" } },
            { description: { contains: filters.q, mode: "insensitive" } },
          ],
        } : {}),
      },
      include: {
        store: { select: { name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } },
        inventory: { select: { variantId: true, quantity: true, reserved: true } },
        variants: { where: { isActive: true }, select: { id: true, isActive: true, inventory: { select: { quantity: true, reserved: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    prisma.promotion.findMany({
      where: {
        storeId: store.id,
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
        products: { some: { product: { ...productWhere, OR: [
          { inventory: { some: { variantId: null, quantity: { gt: 0 } } } },
          { variants: { some: { isActive: true, inventory: { some: { quantity: { gt: 0 } } } } } },
        ] } } },
      },
      include: {
        products: {
          where: { product: { ...productWhere, OR: [
            { inventory: { some: { variantId: null, quantity: { gt: 0 } } } },
            { variants: { some: { isActive: true, inventory: { some: { quantity: { gt: 0 } } } } } },
          ] } },
          include: {
            product: {
              include: {
                store: { select: { name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } },
                inventory: { select: { variantId: true, quantity: true, reserved: true } },
                variants: { where: { isActive: true }, select: { id: true, isActive: true, inventory: { select: { quantity: true, reserved: true } } } },
              },
            },
          },
        },
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: 12,
    }),
    prisma.product.count({ where: productWhere }),
  ]);

  const categoryRows = categoryResult as { category: { id: string; name: string; slug: string } | null }[];
  const products = productResult as DisplayProduct[];
  const availableCategories = categoryRows.flatMap((row) => row.category ? [row.category] : []);
  const promoted = new Map<string, DisplayProduct>();
  for (const campaign of promotionResult as any[]) {
    for (const link of campaign.products) {
      const product = link.product;
      const stockRows = product.variants.length
        ? product.variants.flatMap((variant: any) => variant.inventory)
        : product.inventory.filter((row: any) => row.variantId == null);
      if (campaign.storeId !== store.id || promoted.has(product.id) || stockRows.reduce((sum: number, row: any) => sum + row.quantity - row.reserved, 0) <= 0) continue;
      const price = calculateEffectivePrice(product.price, product.discountPrice, [campaign], now);
      if (!price.promotion) continue;
      promoted.set(product.id, { ...product, storeId: store.id, effectivePrice: price.unitPrice.toFixed(2), campaignName: campaign.name });
    }
  }
  const storefrontProducts = products.filter((product) => !promoted.has(product.id));
  const hasFilters = Boolean(filters.q?.trim() || filters.category);

  return <div className="container py-6 sm:py-9">
    <StorefrontBranding store={publicStorefront} categoryCount={availableCategories.length}/>

    {availableCategories.length > 0 && <nav id="store-categories" aria-label="Mağaza kateqoriyaları" className="mt-6 flex flex-wrap gap-2">
      <Link href={`/stores/${store.id}`} className={`rounded-full px-4 py-2 text-sm font-medium ${!filters.category ? "bg-ink text-white" : "border border-line bg-white text-muted hover:text-emerald"}`}>Bütün məhsullar</Link>
      {availableCategories.map((category) => <Link key={category.id} href={`/stores/${store.id}?category=${encodeURIComponent(category.slug)}`} className={`rounded-full px-4 py-2 text-sm font-medium ${filters.category === category.slug ? "bg-ink text-white" : "border border-line bg-white text-muted hover:text-emerald"}`}>{category.name}</Link>)}
    </nav>}

    <section id="store-products" className="mt-8 scroll-mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">Mağazanın kataloqu</p>
          <h2 className="mt-1 text-2xl font-semibold text-ink">Məhsullar</h2>
          {publicProductCount > 0 && <p className="mt-1 text-sm text-muted">{publicProductCount} yayımlanmış məhsul</p>}
        </div>
        <form action={`/stores/${store.id}`} className="flex w-full gap-2 sm:w-auto">
          {filters.category && <input type="hidden" name="category" value={filters.category}/>}
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-white px-3 sm:w-72">
            <Search size={17} aria-hidden="true" className="shrink-0 text-muted"/>
            <input name="q" defaultValue={filters.q} aria-label={`${store.name} mağazasında axtar`} placeholder="Məhsul axtar" className="w-full py-3 text-sm outline-none"/>
          </label>
          <button className="rounded-xl bg-ink px-4 text-sm font-medium text-white hover:bg-emerald">Axtar</button>
        </form>
      </div>
      <div className="mt-5">
        <ProductGrid
          products={storefrontProducts}
          emptyTitle={hasFilters ? "Uyğun məhsul tapılmadı" : publicProductCount ? "Bu seçimdə məhsul yoxdur" : "Hazırda yayımlanmış məhsul yoxdur"}
          emptyDetail={hasFilters || publicProductCount
            ? "Axtarışı və ya kateqoriya seçimini dəyişərək yenidən yoxlayın."
            : "Mağaza yeni məhsullar əlavə etdikdə onlar burada görünəcək."}
        />
      </div>
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
        {store.contactPhone && <a href={`tel:${store.contactPhone}`} className="mt-2 block text-sm text-muted">Telefon: {store.contactPhone}</a>}
        {store.contactEmail && <a href={`mailto:${store.contactEmail}`} className="mt-1 block text-sm text-muted">E-poçt: {store.contactEmail}</a>}
        {store.mapUrl && <a href={store.mapUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-emerald">Xəritədə aç →</a>}
        {store.latitude !== null && store.longitude !== null && <a href={`https://www.openstreetmap.org/?mlat=${store.latitude}&mlon=${store.longitude}#map=15/${store.latitude}/${store.longitude}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-emerald">Mövqeyi OpenStreetMap-də aç →</a>}
      </div>
      {store.latitude !== null && store.longitude !== null && <InteractiveMap selected={{ latitude: store.latitude, longitude: store.longitude }} className="h-56" zoom={14}/>}
    </section>}
    <div className="mt-8 text-right"><a href="#top" className="text-sm text-muted hover:underline">Səhifənin əvvəlinə ↑</a></div>
  </div>;
}
