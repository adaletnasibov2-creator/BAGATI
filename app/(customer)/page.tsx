import Link from "next/link";
import { ChevronRight, CircleHelp, MapPin, Store } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { CategoryIcon } from "@/components/category-icon";
import { HeroCarousel } from "@/components/home/hero-carousel";
import { StoreCard } from "@/components/store-card";
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
  const heroProducts = availableNewest.slice(0, 2).map((product) => ({
    id: product.id,
    name: product.name,
    price: String(product.price),
    discountPrice: product.discountPrice === null ? null : String(product.discountPrice),
    image: product.images[0] ?? null,
    store: product.store.name,
  }));
  const hasHomepageContent = homepageStores.length > 0
    || featuredProducts.length > 0
    || popular.length > 0
    || newestVisible.length > 0
    || discounted.length > 0
    || promotionalById.size > 0
    || eligibleCampaigns.length > 0;

  return (
    <div className="overflow-hidden bg-[#F7F8F6] text-[#173A3A]">
      <section className="container pb-5 pt-4 sm:pb-7 sm:pt-6">
        <HeroCarousel products={heroProducts} banners={banners} />
      </section>
      <section className="container pb-6 sm:pb-8" aria-label="Alış-veriş məlumatları">
        <ul className="grid gap-2 sm:grid-cols-3 sm:gap-3">
          <li>
            <Link href="/stores" className="bagati-service-link group">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#EFF4F1] text-[#2F6F68] transition group-hover:bg-[#E4EEE8]"><Store aria-hidden="true" size={19} /></span>
              <span><span className="block text-sm font-semibold">Mağazaları kəşf et</span><span className="mt-0.5 block text-xs text-[#5d736c]">Mağaza profillərinə bax</span></span>
            </Link>
          </li>
          <li>
            <Link href="/delivery-returns" className="bagati-service-link group">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#EFF4F1] text-[#2F6F68] transition group-hover:bg-[#E4EEE8]"><MapPin aria-hidden="true" size={19} /></span>
              <span><span className="block text-sm font-semibold">Çatdırılma və qaytarılma</span><span className="mt-0.5 block text-xs text-[#5d736c]">Mövcud məlumatlarla tanış ol</span></span>
            </Link>
          </li>
          <li>
            <Link href="/help" className="bagati-service-link group">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#EFF4F1] text-[#2F6F68] transition group-hover:bg-[#E4EEE8]"><CircleHelp aria-hidden="true" size={19} /></span>
              <span><span className="block text-sm font-semibold">Kömək və dəstək</span><span className="mt-0.5 block text-xs text-[#5d736c]">Suallar və dəstək bölməsi</span></span>
            </Link>
          </li>
        </ul>
      </section>

      {categories.length > 0 && <section className="container pb-7 sm:pb-9" aria-labelledby="categories-title">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div><p className="text-[.68rem] font-semibold uppercase tracking-[.16em] text-[#638078]">BAGATI kataloqu</p><h2 id="categories-title" className="mt-1 text-xl font-semibold tracking-tight text-[#233432] sm:text-2xl">İstədiyini asanlıqla tap</h2></div>
          <Link href="/categories" className="inline-flex min-h-10 shrink-0 items-center gap-1 text-xs font-semibold text-[#46645D] transition hover:text-[#2F6F68] sm:text-sm">Kateqoriyalara keç <ChevronRight size={15}/></Link>
        </div>
        <nav aria-label="Məhsul kateqoriyaları" className="-mx-3 flex gap-2.5 overflow-x-auto px-3 pb-2 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-3 sm:px-0 lg:grid-cols-10">
          {orderedCategories.map((category) => (
            <Link key={category.id} href={`/products?category=${encodeURIComponent(category.slug)}`} className="group flex min-h-[126px] min-w-[108px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border border-[#E5EAE6] bg-white px-2 py-3 text-center shadow-[0_6px_18px_rgba(23,58,58,.035)] outline-none transition hover:-translate-y-0.5 hover:border-[#C9D8D1] hover:shadow-card focus-visible:ring-2 focus-visible:ring-[#4F8175] focus-visible:ring-offset-2 sm:min-w-0">
              <CategoryIcon category={category} size="large" className="rounded-[20px] border border-[#E5EAE6] bg-[#FBFCFA] shadow-[0_5px_16px_rgba(23,58,58,.045)] transition group-hover:border-[#A8C4B7]" />
              <span className="line-clamp-2 min-h-8 max-w-[104px] text-[.74rem] font-semibold leading-4 text-[#405451] sm:text-[.78rem]">{category.name}</span>
            </Link>
          ))}
        </nav>
      </section>}

      {featuredProducts.length > 0 ? (
        <section className="container pb-8 sm:pb-10" aria-labelledby="featured-products-title">
          <SectionHeading eyebrow="BAGATI tərəfindən seçilib" title="Seçilmiş məhsullar" href="/products" actionLabel="Seçilənlərə bax" id="featured-products-title" />
          <ProductGrid products={featuredProducts} />
        </section>
      ) : null}
      {popular.length > 0 && (
        <section className="container pb-8 sm:pb-10" aria-labelledby="popular-title">
          <SectionHeading eyebrow="Çatdırılmış sifarişlər əsasında" title="Populyar məhsullar" href="/products" actionLabel="Kataloqu gəz" id="popular-title" />
          <ProductGrid products={popular.slice(0, 10)} />
        </section>
      )}

      {homepageStores.length > 0 && (
        <section className="border-y border-[#E5EAE6] bg-white py-7 sm:py-9" aria-labelledby="stores-title">
          <div className="container">
            <SectionHeading eyebrow={featuredStores.length ? "BAGATI tərəfindən seçilib" : "Şəhərinə uyğun satıcılar"} title={featuredStores.length ? "Seçilmiş mağazalar" : city?.name ? `${city.name} mağazaları` : "Aktiv mağazalar"} href="/stores" actionLabel="Mağazaları kəşf et" id="stores-title" />
            <div className="mt-5 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
              {homepageStores.slice(0, 4).map((store) => <StoreCard key={store.id} id={store.id} name={store.name} city={store.city.name} description={store.description} logoUrl={store.logoUrl} hasLocation={store.latitude !== null && store.longitude !== null} />)}
            </div>
          </div>
        </section>
      )}
      {newestVisible.length > 0 && (
        <section className="container py-8 sm:py-10" aria-labelledby="new-products-title">
          <SectionHeading eyebrow="Mağazaların son əlavələri" title="Yeni məhsullar" href="/new-products" actionLabel="Son əlavələr" id="new-products-title" />
          <ProductGrid products={newestVisible.slice(0, 10)} />
        </section>
      )}

      {promotionalById.size > 0 && <section className="border-y border-[#E5EAE6] bg-[#EDF3F0] py-7 sm:py-9" aria-labelledby="promotions-title">
          <div className="container">
            <SectionHeading eyebrow="Mağazaların aktiv təklifləri" title="Kampaniyada" href="/deals" actionLabel="Kampaniyaları gör" id="promotions-title" />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
              {[...promotionalById.values()].slice(0, 10).map(({ product, campaign, price, basePrice, discountLabel }) => <ProductCard key={product.id} id={product.id} name={product.name} price={price} originalPrice={basePrice} store={product.store.name} storeHref={`/stores/${product.store.id}`} campaignName={campaign.name} discountLabel={discountLabel} image={product.images[0]} stock={availableStock(product.inventory, product.variants)} lowStockThreshold={Math.max(0, ...(product.variants.length ? product.variants.flatMap((variant: any) => variant.inventory) : product.inventory).map((row: any) => row.lowStockThreshold))} variantCount={product.variants.filter((variant: any)=>variant.inventory.some((row: any)=>row.quantity>row.reserved)).length||undefined}/>)}
            </div>
          </div>
      </section>}

      {discounted.length > 0 && <section className="border-b border-[#E5EAE6] bg-[#F7F8F6] py-7 sm:py-9" aria-labelledby="deals-title">
          <div className="container">
            <SectionHeading eyebrow="Məhsul qiymətlərində" title="Endirimli məhsullar" href="/deals" actionLabel="Endirimlərə bax" id="deals-title" />
            <ProductGrid products={discounted} />
          </div>
      </section>}

      {eligibleCampaigns.length > 0 && (
        <section className="container py-8 sm:py-10" aria-labelledby="campaigns-title">
          <SectionHeading eyebrow="Mağazaların təqdim etdiyi" title="Aktiv kampaniyalar" href="/deals" actionLabel="Kampaniya təfərrüatları" id="campaigns-title" />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {eligibleCampaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} />)}
          </div>
        </section>
      )}

      {!hasHomepageContent && <section className="container pb-9 pt-2 sm:pb-12">
        <div className="relative overflow-hidden rounded-[24px] bg-[#174746] px-5 py-7 text-white shadow-[0_18px_46px_rgba(23,58,58,.13)] sm:rounded-[28px] sm:px-9 sm:py-9">
          <div aria-hidden="true" className="absolute -right-16 -top-40 h-80 w-80 rounded-full border border-[#C9D9CC]/25 sm:right-[8%] sm:h-[26rem] sm:w-[26rem]" />
          <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-[.65rem] font-semibold uppercase tracking-[.2em] text-[#E2D3B5]">{settings.siteName}</p>
              <h2 className="mt-2 text-xl font-semibold leading-tight sm:text-2xl">{settings.homeIntroTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-white/65">{settings.homeIntroDescription}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={settings.homeIntroLinkUrl} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[#F3E9D5] px-5 text-sm font-semibold text-[#24413D] transition hover:bg-white">{settings.homeIntroLinkLabel} <ChevronRight size={16} /></Link>
              <Link href="/vendor/apply" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-white/35 px-5 text-sm font-semibold text-white transition hover:bg-white/10">Mağazanı BAGATI-yə qoş</Link>
            </div>
          </div>
        </div>
      </section>}
    </div>
  );
}

function availableStock(inventory: HomeProduct["inventory"], variants: { inventory: HomeProduct["inventory"] }[] = []) {
  const rows = variants.length ? variants.flatMap((variant) => variant.inventory) : inventory.filter((row: any) => row.variantId == null);
  return rows.reduce((total, row) => total + Math.max(0, row.quantity - row.reserved), 0);
}

function ProductGrid({ products }: { products: HomeProduct[] }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
      {products.map((product) => {
        const effective = calculateEffectivePrice(product.price, product.discountPrice, productPromotions(product.promotionProducts, product.store.id));
        const hasDiscount = effective.unitPrice.lt(effective.basePrice);
        return <ProductCard key={product.id} id={product.id} name={product.name} price={effective.unitPrice.toFixed(2)} originalPrice={hasDiscount ? effective.basePrice.toFixed(2) : null} store={product.store.name} storeHref={`/stores/${product.store.id}`} campaignName={effective.promotion?.name} image={product.images[0]} stock={availableStock(product.inventory, product.variants)} lowStockThreshold={Math.max(0, ...(product.variants.length ? product.variants.flatMap((variant) => variant.inventory) : product.inventory).map((row) => row.lowStockThreshold))} variantCount={product.variants.filter((variant: any)=>variant.inventory.some((row: any)=>row.quantity>row.reserved)).length||undefined} />;
      })}
    </div>
  );
}

function SectionHeading({ eyebrow, title, href, actionLabel, id }: { eyebrow: string; title: string; href: string; actionLabel: string; id: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[.63rem] font-semibold uppercase tracking-[.16em] text-[#638078] sm:text-[.68rem]">{eyebrow}</p>
        <h2 id={id} className="mt-1 text-xl font-semibold tracking-tight text-[#233432] sm:text-2xl">{title}</h2>
      </div>
      <Link href={href} className="inline-flex min-h-10 shrink-0 items-center gap-1 text-[.68rem] font-semibold text-[#46645D] transition hover:text-[#2F6F68] sm:text-sm">{actionLabel}<ChevronRight size={15} /></Link>
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: HomepageCampaign }) {
  const value = Number(campaign.discountValue);
  const discount = campaign.discountType === "PERCENT" && value > 0
    ? `${value}% endirim`
    : campaign.discountType === "FIXED" && value > 0
      ? `${value.toFixed(2)} ₼ endirim`
      : null;

  return (
    <Link href="/deals" className="group rounded-[18px] border border-[#E8E2D5] bg-white p-4 transition hover:-translate-y-0.5 hover:border-[#D9A441]/60 hover:shadow-card">
      <p className="text-[.62rem] font-semibold uppercase tracking-[.14em] text-[#85621d]">{campaign.store?.name ?? "BAGATI marketplace"}</p>
      <h3 className="mt-2 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-[#0B1726] group-hover:text-[#85621d]">{campaign.name}</h3>
      {discount && <p className="mt-2 text-sm font-semibold text-[#28766f]">{discount}</p>}
      <p className="mt-3 text-[.68rem] text-[#667085]">{campaign.startsAt.toLocaleDateString("az-AZ")} – {campaign.endsAt.toLocaleDateString("az-AZ")}</p>
    </Link>
  );
}
