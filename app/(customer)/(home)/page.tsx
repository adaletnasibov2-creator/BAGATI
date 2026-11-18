import Link from "next/link";
import { ArrowRight, ChevronRight, MapPin } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { CategoryIcon } from "@/components/category-icon";
import { HeroCarousel } from "@/components/home/hero-carousel";
import { ProductShelf } from "@/components/home/product-shelf";
import { HomeSectionHeading } from "@/components/home/section-heading";
import { StoreStrip } from "@/components/home/store-strip";
import { TrustRow } from "@/components/home/trust-row";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { publicProductVisibilityWhere, publicStoreVisibilityWhere } from "@/lib/store-visibility";
import { calculateEffectivePrice } from "@/lib/promotion-pricing";
import { productPromotions } from "@/lib/promotion-pricing";
import { getSiteSettings } from "@/lib/site-settings";
import { getPublicCategoryData, type PublicCategoryNode } from "@/lib/public-category-tree";
import { selectHomepageCampaignProducts, type HomepageCampaign } from "@/lib/homepage-campaign-products";
import { findHomepageCampaignProductBatches } from "@/lib/homepage-campaign-query";
import { resolvePublicStoreEligibility } from "@/lib/store-eligibility";
import { resolveActiveCity } from "@/lib/city-resolution";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ city?: string }> };
type HomeCategory = PublicCategoryNode;
type HomeStore = {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  city: { name: string };
};
type HomeProduct = {
  id: string;
  storeId: string;
  name: string;
  price: Prisma.Decimal;
  discountPrice: Prisma.Decimal | null;
  images: string[];
  sku: string | null;
  store: { id: string; name: string };
  promotionProducts: { promotion: { id: string; storeId: string | null; name: string; startsAt: Date; endsAt: Date; isActive: boolean; discountType: string | null; discountValue: Prisma.Decimal | null } }[];
  inventory: { variantId?: string | null; quantity: number; reserved: number; lowStockThreshold: number }[];
  variants: { isActive: boolean; options: unknown; inventory: { quantity: number; reserved: number; lowStockThreshold: number }[] }[];
};
type PopularOrderRow = { productId: string; _sum: { quantity: number | null } };

export default async function HomePage({ searchParams }: Props) {
  const params = await searchParams;
  // Falls back to the default/first active city instead of an empty page when the slug is missing or inactive.
  const activeCities = await prisma.city.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true },
    orderBy: { name: "asc" },
  });
  const city = resolveActiveCity(activeCities, params.city);
  const now = new Date();
  const cityStoreFilter = city ? { cityId: city.id } : { cityId: "__no_active_city__" };
  const storeFilter = { ...publicStoreVisibilityWhere(), ...cityStoreFilter };
  const productFilter = publicProductVisibilityWhere(storeFilter);

  const [categories, stores, newest, popularRows, discountCandidates, campaigns, promotionalCampaigns, settings, banners, featuredProductLinks, featuredStoreLinks] = await Promise.all([
    // Top-levels with visible products, in sortOrder (hidden when empty; owner decision 2026-11-15).
    getPublicCategoryData().then((data) => data.tree),
    prisma.store.findMany({
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
    prisma.product.findMany({
      where: productFilter,
      take: 10,
      orderBy: { createdAt: "desc" },
      include: {
        store: { select: { id: true, name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } },
        inventory: { select: { variantId: true, quantity: true, reserved: true, lowStockThreshold: true } },
        variants: { where: { isActive: true }, select: { isActive: true, options: true, inventory: { select: { variantId: true, quantity: true, reserved: true, lowStockThreshold: true } } } },
        promotionProducts: { include: { promotion: true } },
      },
    }),
    prisma.orderItem.groupBy({
      by: ["productId"],
      where: { storeOrder: { status: "DELIVERED", store: storeFilter } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    }),
    prisma.product.findMany({
      where: { ...productFilter, discountPrice: { not: null } },
      take: 40,
      // id breaks createdAt ties (bulk-created products share a timestamp), so the shelf is the same on every request.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        store: { select: { id: true, name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } },
        inventory: { select: { variantId: true, quantity: true, reserved: true, lowStockThreshold: true } },
        variants: { where: { isActive: true }, select: { isActive: true, options: true, inventory: { select: { variantId: true, quantity: true, reserved: true, lowStockThreshold: true } } } },
        promotionProducts: { include: { promotion: true } },
      },
    }),
    prisma.promotion.findMany({
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
    prisma.promotion.findMany({
      where: {
        storeId: { not: null }, isActive: true, startsAt: { lte: now }, endsAt: { gte: now }, store: storeFilter,
        products: { some: { product: { status: "ACTIVE", store: storeFilter, OR: [
          { variants: { none: { isActive: true } }, inventory: { some: { variantId: null, quantity: { gt: prisma.inventory.fields.reserved } } } },
          { variants: { some: { isActive: true, inventory: { some: { quantity: { gt: prisma.inventory.fields.reserved } } } } } },
        ] } } },
      },
      select: { id: true, storeId: true, name: true, startsAt: true, endsAt: true, isActive: true, discountType: true, discountValue: true, store: { select: { name: true } } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: 8,
    }),
    getSiteSettings(),
    prisma.homeBanner.findMany({
      where: { isActive: true, startsAt: { lte: now }, endsAt: { gte: now } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: 8,
    }),
    prisma.homepageFeaturedProduct.findMany({ orderBy: { position: "asc" }, select: { productId: true }, take: 12 }),
    prisma.homepageFeaturedStore.findMany({ orderBy: { position: "asc" }, select: { storeId: true }, take: 12 }),
  ]) as [HomeCategory[], HomeStore[], HomeProduct[], PopularOrderRow[], HomeProduct[], HomepageCampaign[], HomepageCampaign[], Awaited<ReturnType<typeof getSiteSettings>>, { id: string; title: string; description: string; imageUrl: string; buttonLabel: string; href: string; startsAt: Date; endsAt: Date; isActive: boolean; sortOrder: number }[], { productId: string }[], { storeId: string }[]];
  const orderedCategories = categories;

  // One query for all campaigns (was one per campaign); first 10 per campaign, same filter and order.
  const campaignProductsByPromotion = await findHomepageCampaignProductBatches(prisma, promotionalCampaigns, storeFilter, 10);

  const featuredProductIds = featuredProductLinks.map((item) => item.productId);
  const featuredStoreIds = featuredStoreLinks.map((item) => item.storeId);

  const [popularProductsResult, featuredProductsResult, selectedStores] = await Promise.all([
    popularRows.length
      ? prisma.product.findMany({
        where: { ...productFilter, id: { in: popularRows.map((row) => row.productId) } },
        include: {
          store: { select: { id: true, name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } },
          inventory: { select: { variantId: true, quantity: true, reserved: true, lowStockThreshold: true } },
          variants: { where: { isActive: true }, select: { isActive: true, options: true, inventory: { select: { variantId: true, quantity: true, reserved: true, lowStockThreshold: true } } } },
          promotionProducts: { include: { promotion: true } },
        },
      })
      : Promise.resolve([]),
    featuredProductIds.length
      ? prisma.product.findMany({
          where: { ...productFilter, id: { in: featuredProductIds } },
          include: {
            store: { select: { id: true, name: true, isActive: true, status: true, subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { slug: true, isActive: true } } } } } },
            inventory: { select: { variantId: true, quantity: true, reserved: true, lowStockThreshold: true } },
            variants: { where: { isActive: true }, select: { isActive: true, options: true, inventory: { select: { quantity: true, reserved: true, lowStockThreshold: true } } } },
            promotionProducts: { include: { promotion: true } },
          },
        })
      : Promise.resolve([]),
    featuredStoreIds.length
      ? prisma.store.findMany({
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
  ], prisma, now);
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
  const availableNewest = newestVisible.filter((product) => availableStock(product.inventory, product.variants) > 0);
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

  return (
    <div className="overflow-hidden bg-bagati-page text-bagati-deep">
      <section className="container pb-6 pt-3 sm:pb-8 sm:pt-5">
        <HeroCarousel banners={banners} />
      </section>

      <TrustRow />

      {categories.length > 0 && <section className="container py-8 sm:py-10" aria-labelledby="categories-title">
        <HomeSectionHeading id="categories-title" eyebrow="BAGATI kataloqu" title="Nə axtarırsan?" href="/categories" />
        <nav aria-label="Məhsul kateqoriyaları" className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-10">
          {orderedCategories.map((category) => (
            <Link key={category.id} href={`/products?category=${encodeURIComponent(category.slug)}`} className="group flex min-h-[148px] w-[112px] shrink-0 snap-start flex-col items-center justify-start gap-3 rounded-card border border-line bg-white px-2 pb-3 pt-4 text-center transition-[transform,box-shadow,border-color] duration-200 hover:border-brand-200 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none sm:w-auto sm:min-w-0">
              <CategoryIcon category={category} size="large" loading="lazy" />
              <span className="line-clamp-2 min-h-10 max-w-[104px] text-sm font-medium leading-5 text-fg group-hover:text-primary">{category.name}</span>
            </Link>
          ))}
        </nav>
      </section>}

      {featuredProducts.length > 0 && (
        <ProductShelf id="featured-products" eyebrow="BAGATI seçimi" title="Seçilmiş məhsullar" href="/products" actionLabel="Hamısına bax">
          <HomeProductCards products={featuredProducts} />
        </ProductShelf>
      )}
      {popular.length > 0 && (
        <ProductShelf id="popular-products" eyebrow="Çatdırılmış sifarişlər əsasında" title="Populyar məhsullar" href="/products" actionLabel="Hamısına bax">
          <HomeProductCards products={popular.slice(0, 10)} />
        </ProductShelf>
      )}
      {newestVisible.length > 0 && (
        <ProductShelf id="new-products" eyebrow="Mağazaların son əlavələri" title="Yeni məhsullar" href="/new-products" actionLabel="Hamısına bax">
          <HomeProductCards products={newestVisible.slice(0, 10)} />
        </ProductShelf>
      )}
      {promotionalById.size > 0 && (
        <div className="border-y border-line bg-surface-sunken">
          <ProductShelf id="campaign-products" eyebrow="Mağazaların aktiv təklifləri" title="Kampaniyada" href="/deals" actionLabel="Hamısına bax">
            {[...promotionalById.values()].slice(0, 10).map(({ product, campaign, price, basePrice, discountLabel }) => (
              <div key={product.id} className="min-w-0 snap-start">
                <ProductCard
                  id={product.id}
                  name={product.name}
                  price={price}
                  originalPrice={basePrice}
                  store={product.store.name}
                  storeHref={`/stores/${product.store.id}`}
                  campaignName={campaign.name}
                  discountLabel={discountLabel}
                  image={product.images[0]}
                  secondaryImage={product.images[1]}
                  stock={availableStock(product.inventory, product.variants)}
                  lowStockThreshold={Math.max(0, ...(product.variants.length ? product.variants.flatMap((variant: any) => variant.inventory) : product.inventory).map((row: any) => row.lowStockThreshold))}
                  variantCount={product.variants.filter((variant: any) => variant.inventory.some((row: any) => row.quantity > row.reserved)).length || undefined}
                />
              </div>
            ))}
          </ProductShelf>
        </div>
      )}
      {discounted.length > 0 && (
        <ProductShelf id="discounted-products" eyebrow="Real qiymət fərqi ilə" title="Endirimli məhsullar" href="/deals" actionLabel="Hamısına bax">
          <HomeProductCards products={discounted} />
        </ProductShelf>
      )}

      {eligibleCampaigns.length > 0 && (
        <section className="py-8 sm:py-10" aria-labelledby="campaigns-title">
          <div className="container">
            <HomeSectionHeading id="campaigns-title" eyebrow="Mağazaların aktiv təklifləri" title="Kampaniyalar" href="/deals" />
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
              {eligibleCampaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} />)}
            </div>
          </div>
        </section>
      )}

      {homepageStores.length > 0 && (
        <section className="border-y border-line bg-surface-sunken py-8 sm:py-10" aria-labelledby="stores-title">
          <div className="container">
            <HomeSectionHeading id="stores-title" eyebrow={featuredStores.length ? "BAGATI seçimi" : "Şəhərinə uyğun"} title={featuredStores.length ? "Seçilmiş mağazalar" : city?.slug === "qazax" ? "Qazax mağazaları" : city?.name ? `${city.name} mağazaları` : "Mağazalar"} href="/stores">
              <Link href="/stores/map" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-line-strong bg-white px-4 text-sm font-semibold text-fg-body transition-colors hover:border-primary hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
                <MapPin aria-hidden="true" size={16} /><span className="hidden sm:inline">Xəritəyə bax</span><span className="sr-only sm:hidden">Xəritəyə bax</span>
              </Link>
            </HomeSectionHeading>
            <StoreStrip stores={homepageStores.slice(0, 4)} />
          </div>
        </section>
      )}

      <section className="container py-8 sm:py-10" aria-labelledby="seller-cta-title">
        <div className="bagati-on-dark relative isolate overflow-hidden rounded-feature bg-primary px-6 py-8 text-white shadow-overlay sm:flex sm:items-center sm:justify-between sm:gap-8 sm:px-10 sm:py-10">
          {/* Decorative gold line-art arcs (CSS only). */}
          <span aria-hidden="true" className="absolute -right-20 -top-28 -z-10 h-80 w-80 rounded-full border border-[rgba(199,154,82,0.45)] sm:right-[6%] sm:h-[26rem] sm:w-[26rem]" />
          <span aria-hidden="true" className="absolute -right-6 -top-14 -z-10 h-52 w-52 rounded-full border border-[rgba(199,154,82,0.28)] sm:right-[14%] sm:h-72 sm:w-72" />
          <div className="max-w-2xl">
            <p className="flex items-center gap-3 text-kicker uppercase text-gold-200">
              <span aria-hidden="true" className="h-px w-8 shrink-0 bg-gold-400" />BAGATI-də satıcı ol
            </p>
            <h2 id="seller-cta-title" className="mt-3 text-h2 text-white">Mağazanı BAGATI-də aç</h2>
            <p className="mt-2 text-body text-white/85">Müraciətə başla və mağazan üçün hesab yarat.</p>
          </div>
          <Link href="/vendor/apply" className="mt-6 inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-gold-100 px-6 text-body font-semibold text-fg shadow-subtle transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold motion-reduce:transition-none sm:mt-0">
            Satıcı ol<ArrowRight aria-hidden="true" size={17} />
          </Link>
        </div>
      </section>

      {!hasHomepageContent && (
        <section className="container pb-9 pt-1 sm:pb-12">
          <div className="rounded-card border border-line bg-white p-6 sm:p-8">
            <p className="text-kicker uppercase text-gold-700">{settings.siteName}</p>
            <h2 className="mt-2 text-h2 text-fg">{settings.homeIntroTitle}</h2>
            <p className="mt-2 max-w-2xl text-body text-fg-secondary">{settings.homeIntroDescription}</p>
            <Link href={settings.homeIntroLinkUrl} className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 text-body font-semibold text-white transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none">
              {settings.homeIntroLinkLabel}<ChevronRight aria-hidden="true" size={16} />
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

function availableStock(inventory: HomeProduct["inventory"], variants: { inventory: HomeProduct["inventory"] }[] = []) {
  const rows = variants.length ? variants.flatMap((variant) => variant.inventory) : inventory.filter((row: any) => row.variantId == null);
  return rows.reduce((total, row) => total + Math.max(0, row.quantity - row.reserved), 0);
}

function HomeProductCards({ products }: { products: HomeProduct[] }) {
  return products.map((product) => {
    const effective = calculateEffectivePrice(product.price, product.discountPrice, productPromotions(product.promotionProducts, product.store.id));
    const hasDiscount = effective.unitPrice.lt(effective.basePrice);
    return (
      <div key={product.id} className="min-w-0 snap-start">
        <ProductCard
          id={product.id}
          name={product.name}
          price={effective.unitPrice.toFixed(2)}
          originalPrice={hasDiscount ? effective.basePrice.toFixed(2) : null}
          store={product.store.name}
          storeHref={`/stores/${product.store.id}`}
          campaignName={effective.promotion?.name}
          image={product.images[0]}
          secondaryImage={product.images[1]}
          stock={availableStock(product.inventory, product.variants)}
          lowStockThreshold={Math.max(0, ...(product.variants.length ? product.variants.flatMap((variant) => variant.inventory) : product.inventory).map((row) => row.lowStockThreshold))}
          variantCount={product.variants.filter((variant: any) => variant.inventory.some((row: any) => row.quantity > row.reserved)).length || undefined}
        />
      </div>
    );
  });
}

function CampaignCard({ campaign }: { campaign: HomepageCampaign }) {
  const discount = campaignDiscount(campaign);
  return (
    <Link href="/deals" className="group flex flex-col rounded-card border border-line bg-white p-5 transition-[transform,box-shadow,border-color] duration-200 hover:border-gold-200 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none">
      <p className="truncate text-kicker uppercase text-gold-700">{campaign.store?.name ?? "BAGATI kampaniyası"}</p>
      <h3 className="mt-2 line-clamp-2 min-h-10 text-body font-semibold leading-5 text-fg group-hover:text-primary">{campaign.name}</h3>
      {discount && <p className="mt-3 w-fit rounded-full bg-gold-100 px-3 py-1 text-sm font-semibold text-gold-700 ring-1 ring-inset ring-gold-200">{discount}</p>}
      <p className="mt-auto pt-4 text-xs text-fg-muted">{campaign.startsAt.toLocaleDateString("az-AZ")} – {campaign.endsAt.toLocaleDateString("az-AZ")}</p>
    </Link>
  );
}

function campaignDiscount(campaign: HomepageCampaign) {
  const value = Number(campaign.discountValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (campaign.discountType === "PERCENT") return `${value}% endirim`;
  if (campaign.discountType === "FIXED") return `${value.toFixed(2)} ₼ endirim`;
  return null;
}
