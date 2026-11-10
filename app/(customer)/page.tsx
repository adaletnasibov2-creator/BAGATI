import Link from "next/link";
import { ChevronRight, MapPin, Store } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { CategoryIcon } from "@/components/category-icon";
import { HeroCarousel } from "@/components/home/hero-carousel";
import { ProductShelf } from "@/components/home/product-shelf";
import { StoreCard } from "@/components/store-card";
import StorefrontImage from "@/components/storefront-image";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { publicProductVisibilityWhere, publicStoreVisibilityWhere } from "@/lib/store-visibility";
import { calculateEffectivePrice } from "@/lib/promotion-pricing";
import { productPromotions } from "@/lib/promotion-pricing";
import { getSiteSettings } from "@/lib/site-settings";
import { categoriesWithOtherLast } from "@/lib/category-order";
import { selectHomepageCampaignProducts, type HomepageCampaign } from "@/lib/homepage-campaign-products";
import { resolvePublicStoreEligibility } from "@/lib/store-eligibility";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ city?: string }> };
type HomeCategory = { id: string; name: string; slug: string };
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
  const citySlug = params.city || "qazax";
  const city = await prisma.city.findFirst({
    where: { slug: citySlug, isActive: true },
    select: { id: true, name: true, slug: true },
  });
  const now = new Date();
  const cityStoreFilter = city ? { cityId: city.id } : { cityId: "__no_active_city__" };
  const storeFilter = { ...publicStoreVisibilityWhere(), ...cityStoreFilter };
  const productFilter = publicProductVisibilityWhere(storeFilter);

  const [categories, stores, newest, popularRows, discountCandidates, campaigns, promotionalCampaigns, settings, banners, featuredProductLinks, featuredStoreLinks] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true, parentId: null },
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
      take: 10,
    }),
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
      orderBy: { createdAt: "desc" },
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
  const orderedCategories = categoriesWithOtherLast(categories);

  const campaignProductsByPromotion = await Promise.all(promotionalCampaigns.map((campaign) => prisma.promotionProduct.findMany({
    where: { promotionId: campaign.id, product: { status: "ACTIVE", storeId: campaign.storeId!, store: storeFilter, OR: [
      { variants: { none: { isActive: true } }, inventory: { some: { variantId: null, quantity: { gt: prisma.inventory.fields.reserved } } } },
      { variants: { some: { isActive: true, inventory: { some: { quantity: { gt: prisma.inventory.fields.reserved } } } } } },
    ] } },
    orderBy: [{ product: { name: "asc" } }, { product: { id: "asc" } }],
    take: 10,
    select: { product: { select: {
      id: true, storeId: true, name: true, price: true, discountPrice: true, images: true,
      store: { select: { id: true, name: true } },
      inventory: { select: { variantId: true, quantity: true, reserved: true, lowStockThreshold: true } },
      variants: { where: { isActive: true }, select: { isActive: true, options: true, inventory: { select: { quantity: true, reserved: true, lowStockThreshold: true } } } },
    } } },
  })));

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

      {categories.length > 0 && <section className="container pb-4 pt-2 sm:pb-6" aria-labelledby="categories-title">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[.65rem] font-semibold uppercase tracking-[.16em] text-bagati-muted">BAGATI kataloqu</p>
            <h2 id="categories-title" className="mt-1 text-xl font-semibold tracking-tight text-bagati-text sm:text-2xl">Nə axtarırsan?</h2>
          </div>
          <Link href="/categories" className="inline-flex min-h-10 shrink-0 items-center gap-1 text-xs font-semibold text-bagati-text transition hover:text-bagati-accent focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold sm:text-sm">
            Hamısına bax<ChevronRight aria-hidden="true" size={15} />
          </Link>
        </div>
        <nav aria-label="Məhsul kateqoriyaları" className="-mx-3 flex snap-x gap-2.5 overflow-x-auto px-3 pb-2 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-3 sm:px-0 lg:grid-cols-10">
          {orderedCategories.map((category) => (
            <Link key={category.id} href={`/products?category=${encodeURIComponent(category.slug)}`} className="group flex min-h-[142px] min-w-[108px] shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-[20px] border border-bagati-border bg-white px-2 py-3 text-center shadow-[0_6px_18px_rgba(23,58,58,.035)] outline-none transition duration-200 hover:-translate-y-0.5 hover:border-[#C9D8D1] hover:shadow-card focus-visible:ring-2 focus-visible:ring-bagati-gold focus-visible:ring-offset-2 motion-reduce:transition-none sm:min-w-0">
              <CategoryIcon category={category} size="large" />
              <span className="line-clamp-2 min-h-8 max-w-[104px] text-[.74rem] font-semibold leading-4 text-bagati-text sm:text-[.78rem]">{category.name}</span>
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
        <div className="border-y border-bagati-border bg-bagati-section">
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
        <section className="border-y border-bagati-border bg-white py-8 sm:py-10" aria-labelledby="campaigns-title">
          <div className="container">
            <SectionHeading eyebrow="Mağazaların aktiv təklifləri" title="Kampaniyalar" href="/deals" actionLabel="Hamısına bax" id="campaigns-title" />
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {eligibleCampaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} />)}
            </div>
          </div>
        </section>
      )}

      {homepageStores.length > 0 && (
        <section className="border-y border-bagati-border bg-bagati-section py-8 sm:py-10" aria-labelledby="stores-title">
          <div className="container">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <SectionHeading eyebrow={featuredStores.length ? "BAGATI seçimi" : "Şəhərinə uyğun"} title={featuredStores.length ? "Seçilmiş mağazalar" : city?.slug === "qazax" ? "Qazax mağazaları" : city?.name ? `${city.name} mağazaları` : "Mağazalar"} href="/stores" actionLabel="Hamısına bax" id="stores-title" />
              <Link href="/stores/map" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-bagati-border bg-white px-4 text-xs font-semibold text-bagati-text transition hover:border-bagati-accent hover:text-bagati-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold sm:text-sm">
                <MapPin aria-hidden="true" size={15} />Xəritəyə bax
              </Link>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
              {homepageStores.slice(0, 4).map((store) => <StoreCard key={store.id} id={store.id} name={store.name} city={store.city.name} description={store.description} logoUrl={store.logoUrl} hasLocation={store.latitude !== null && store.longitude !== null} />)}
            </div>
          </div>
        </section>
      )}

      <section className="container py-8 sm:py-10">
        <div className="relative isolate overflow-hidden rounded-[24px] bg-bagati-primary px-5 py-6 text-white shadow-[0_18px_46px_rgba(23,58,58,.13)] sm:flex sm:items-center sm:justify-between sm:gap-6 sm:rounded-[30px] sm:px-9 sm:py-8">
          <div aria-hidden="true" className="absolute -right-16 -top-32 -z-10 h-72 w-72 rounded-full border border-[#C9D9CC]/25 sm:right-[8%] sm:h-[23rem] sm:w-[23rem]" />
          <div className="max-w-2xl">
            <p className="text-[.65rem] font-semibold uppercase tracking-[.18em] text-bagati-cream-dark">BAGATI-də satıcı ol</p>
            <h2 className="mt-2 text-xl font-semibold leading-tight sm:text-2xl">Mağazanı BAGATI-də aç</h2>
            <p className="mt-2 text-sm leading-6 text-white/80">Müraciətə başla və mağazan üçün hesab yarat.</p>
          </div>
          <Link href="/vendor/apply" className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-bagati-cream px-5 text-sm font-semibold text-bagati-deep transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold sm:mt-0">
            Satıcı ol<ChevronRight aria-hidden="true" size={16} />
          </Link>
        </div>
      </section>

      {!hasHomepageContent && (
        <section className="container pb-9 pt-1 sm:pb-12">
          <div className="rounded-2xl border border-bagati-border bg-white p-5 sm:p-7">
            <p className="text-[.65rem] font-semibold uppercase tracking-[.16em] text-bagati-muted">{settings.siteName}</p>
            <h2 className="mt-2 text-xl font-semibold text-bagati-deep">{settings.homeIntroTitle}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-bagati-secondary">{settings.homeIntroDescription}</p>
            <Link href={settings.homeIntroLinkUrl} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-bagati-primary px-5 text-sm font-semibold text-white transition hover:bg-bagati-hover">
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

function SectionHeading({ eyebrow, title, href, actionLabel, id }: { eyebrow: string; title: string; href: string; actionLabel: string; id: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[.63rem] font-semibold uppercase tracking-[.16em] text-bagati-muted sm:text-[.68rem]">{eyebrow}</p>
        <h2 id={id} className="mt-1 text-xl font-semibold tracking-tight text-bagati-text sm:text-2xl">{title}</h2>
      </div>
      <Link href={href} className="inline-flex min-h-10 shrink-0 items-center gap-1 text-[.68rem] font-semibold text-bagati-text transition hover:text-bagati-accent sm:text-sm">{actionLabel}<ChevronRight size={15} /></Link>
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: HomepageCampaign }) {
  return (
    <Link href="/deals" className="group rounded-[20px] border border-bagati-border bg-white p-4 transition hover:-translate-y-0.5 hover:border-bagati-gold hover:shadow-card motion-reduce:transition-none">
      <p className="text-[.62rem] font-semibold uppercase tracking-[.14em] text-bagati-gold-dark">{campaign.store?.name ?? "BAGATI kampaniyası"}</p>
      <h3 className="mt-2 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-bagati-text group-hover:text-bagati-accent">{campaign.name}</h3>
      {campaignDiscount(campaign) && <p className="mt-2 text-sm font-semibold text-bagati-accent">{campaignDiscount(campaign)}</p>}
      <p className="mt-3 text-[.68rem] text-bagati-muted">{campaign.startsAt.toLocaleDateString("az-AZ")} – {campaign.endsAt.toLocaleDateString("az-AZ")}</p>
    </Link>
  );
}

function CampaignSpotlight({ campaign }: { campaign: HomepageCampaign }) {
  return (
    <Link href="/deals" className="group relative isolate flex min-h-[148px] flex-col justify-between overflow-hidden rounded-[22px] border border-[#E6D8BD] bg-gradient-to-br from-bagati-cream to-[#FBF8F0] p-4 transition hover:-translate-y-0.5 hover:shadow-card sm:min-h-[164px] sm:p-5 lg:min-h-0 lg:flex-1 motion-reduce:transition-none">
      <span aria-hidden="true" className="absolute -right-9 -top-12 -z-10 h-40 w-40 rounded-full border-[18px] border-white/35" />
      <div>
        <p className="text-[.62rem] font-semibold uppercase tracking-[.14em] text-bagati-gold-dark">İndi aktiv</p>
        <h2 className="mt-2 line-clamp-2 text-base font-semibold leading-5 text-bagati-deep sm:text-lg">{campaign.name}</h2>
        {campaign.store?.name && <p className="mt-1 truncate text-xs text-bagati-text-secondary">{campaign.store.name}</p>}
      </div>
      <span className="mt-3 inline-flex w-fit items-center gap-1 text-xs font-semibold text-bagati-primary">
        {campaignDiscount(campaign) ?? "Kampaniyaya bax"}<ChevronRight aria-hidden="true" size={14} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

function ProductSpotlight({ product }: { product: HomeProduct }) {
  const effective = calculateEffectivePrice(product.price, product.discountPrice, productPromotions(product.promotionProducts, product.store.id));
  const discountedPrice = effective.unitPrice.lt(effective.basePrice);
  return (
    <Link href={`/products/${product.id}`} className="group relative isolate flex min-h-[148px] items-center gap-3 overflow-hidden rounded-[22px] border border-bagati-border bg-white p-3.5 transition hover:-translate-y-0.5 hover:shadow-card sm:min-h-[164px] sm:p-4 lg:min-h-0 lg:flex-1 motion-reduce:transition-none">
      <span aria-hidden="true" className="absolute -bottom-16 -right-10 -z-10 h-44 w-44 rounded-full bg-bagati-section" />
      <div className="relative aspect-square w-[90px] shrink-0 overflow-hidden rounded-[17px] bg-bagati-page sm:w-[104px]">
        <StorefrontImage
          src={product.images[0] ?? null}
          alt={product.images[0] ? product.name : ""}
          fill
          sizes="104px"
          className="object-contain p-2"
          fallback={<span className="grid h-full w-full place-items-center text-bagati-muted"><Store aria-hidden="true" size={26} /></span>}
        />
      </div>
      <div className="min-w-0">
        <p className="text-[.62rem] font-semibold uppercase tracking-[.12em] text-bagati-muted">Yeni məhsul</p>
        <p className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-bagati-text group-hover:text-bagati-accent">{product.name}</p>
        <p className="mt-1 truncate text-xs text-bagati-muted">{product.store.name}</p>
        <p className="mt-2 text-sm font-semibold text-bagati-deep">
          {effective.unitPrice.toFixed(2)} ₼
          {discountedPrice && <del className="ml-2 text-xs font-normal text-bagati-muted">{effective.basePrice.toFixed(2)} ₼</del>}
        </p>
      </div>
    </Link>
  );
}

function SellerSpotlight() {
  return (
    <Link href="/vendor/apply" className="group relative isolate flex min-h-[148px] flex-col justify-between overflow-hidden rounded-[22px] bg-bagati-primary p-4 text-white transition hover:-translate-y-0.5 hover:shadow-card sm:min-h-[164px] sm:p-5 lg:min-h-0 lg:flex-1 motion-reduce:transition-none">
      <span aria-hidden="true" className="absolute -right-8 -top-12 -z-10 h-36 w-36 rounded-full border-[18px] border-white/10" />
      <span className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-bagati-cream"><Store aria-hidden="true" size={19} /></span>
      <span>
        <span className="block text-[.62rem] font-semibold uppercase tracking-[.14em] text-bagati-cream-dark">Satıcı ol</span>
        <span className="mt-1 block text-base font-semibold">Mağazanı BAGATI-də aç</span>
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-white/85">Müraciətə başla<ChevronRight aria-hidden="true" size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
      </span>
    </Link>
  );
}

function CitySpotlight({ city }: { city: string }) {
  return (
    <Link href="/stores/map" className="group relative isolate flex min-h-[148px] flex-col justify-between overflow-hidden rounded-[22px] border border-bagati-border bg-bagati-section p-4 transition hover:-translate-y-0.5 hover:shadow-card sm:min-h-[164px] sm:p-5 lg:min-h-0 lg:flex-1 motion-reduce:transition-none">
      <span aria-hidden="true" className="absolute -right-7 -top-9 -z-10 h-36 w-36 rounded-full border-[18px] border-white/55" />
      <MapPin aria-hidden="true" size={20} className="text-bagati-accent" />
      <span>
        <span className="block text-[.62rem] font-semibold uppercase tracking-[.14em] text-bagati-muted">Şəhərindən kəşf et</span>
        <span className="mt-1 block text-base font-semibold text-bagati-deep">{city} mağazaları</span>
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-bagati-primary">Xəritəyə bax<ChevronRight aria-hidden="true" size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
      </span>
    </Link>
  );
}

function CategorySpotlight() {
  return (
    <Link href="/categories" className="group relative isolate flex min-h-[148px] flex-col justify-between overflow-hidden rounded-[22px] border border-bagati-border bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-card sm:min-h-[164px] sm:p-5 lg:min-h-0 lg:flex-1 motion-reduce:transition-none">
      <span aria-hidden="true" className="absolute -right-7 -top-9 -z-10 h-36 w-36 rounded-full bg-bagati-section" />
      <Store aria-hidden="true" size={20} className="text-bagati-accent" />
      <span>
        <span className="block text-[.62rem] font-semibold uppercase tracking-[.14em] text-bagati-muted">Kəşfə başla</span>
        <span className="mt-1 block text-base font-semibold text-bagati-deep">Kateqoriyalara göz at</span>
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-bagati-primary">Bölmələri gör<ChevronRight aria-hidden="true" size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
      </span>
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
