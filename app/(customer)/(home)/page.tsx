import Link from "next/link";
import { ArrowRight, ChevronRight, MapPin } from "lucide-react";
import { ProductCard } from "@/components/product-card";
import { CategoryIcon } from "@/components/category-icon";
import { HeroCarousel } from "@/components/home/hero-carousel";
import { HERO_PRE_PAINT_SCRIPT } from "@/lib/hero-viewport";
import { ProductShelf } from "@/components/home/product-shelf";
import { HomeSectionHeading } from "@/components/home/section-heading";
import { StoreStrip } from "@/components/home/store-strip";
import { TrustRow } from "@/components/home/trust-row";
import { getActiveCities } from "@/lib/active-cities";
import { calculateEffectivePrice } from "@/lib/promotion-pricing";
import { productPromotions } from "@/lib/promotion-pricing";
import { getSiteSettings } from "@/lib/site-settings";
import { getPublicCategoryData } from "@/lib/public-category-tree";
import type { HomepageCampaign } from "@/lib/homepage-campaign-products";
import { resolveActiveCity } from "@/lib/city-resolution";
import { availableStock, getHomePageData, type HomeProduct } from "@/lib/home-page-data";
import type { Metadata } from "next";
import { getSetting } from "@/lib/settings/read";
import { SETTING_KEYS } from "@/lib/settings/registry";
import { canonicalMetadata, homeSharePreviewMetadata } from "@/lib/share-preview";
import { homeJsonLd, serializeJsonLd } from "@/lib/structured-data";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ city?: string }> };

/**
 * SMALL-FIXES-1 D: share preview (og:* / twitter:*) for the home page from the existing settings only (same cached
 * reads as the root layout). The <title> and description stay the root defaults; og:url is the site root.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [settings, description, ogTitle, ogDescription] = await Promise.all([
    getSiteSettings(),
    getSetting<string>(SETTING_KEYS.seoDefaultDescription),
    getSetting<string>(SETTING_KEYS.seoDefaultOgTitle),
    getSetting<string>(SETTING_KEYS.seoDefaultOgDescription),
  ]);
  // SMALL-FIXES-2: + rel=canonical to the site root (= og:url), absolute from APP_BASE_URL, left out without a valid base.
  return { ...homeSharePreviewMetadata({ siteName: settings.siteName, description: description ?? null, ogTitle: ogTitle ?? null, ogDescription: ogDescription ?? null }), ...canonicalMetadata("/") };
}

export default async function HomePage({ searchParams }: Props) {
  const params = await searchParams;
  // Falls back to the default/first active city instead of an empty page when the slug is missing or inactive.
  // The layout's cached list (lib/active-cities.ts): no second city query.
  const activeCities = await getActiveCities();
  const city = resolveActiveCity(activeCities, params.city);

  // Shelves, banners, campaigns and stores come from a 30 s per-city cache (lib/home-page-data.ts, SCALE-FIX-2 B3);
  // nothing per visitor is in it. Categories and settings keep their own 30 s caches.
  const [categories, settings, home] = await Promise.all([
    // Top-levels with visible products, in sortOrder (hidden when empty; owner decision 2026-11-15).
    getPublicCategoryData().then((data) => data.tree),
    getSiteSettings(),
    getHomePageData(city),
  ]);
  const { banners, featuredProducts, popular, newestVisible, promotionalById, discounted, eligibleCampaigns, homepageStores, storesAreFeatured, hasHomepageContent } = home;
  const orderedCategories = categories;
  // SEO-1: WebSite + Organization (name, url, logo); left out without a valid APP_BASE_URL. No SearchAction.
  const siteJsonLd = homeJsonLd();

  return (
    <div className="overflow-hidden bg-bagati-page text-bagati-deep">
      {siteJsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteJsonLd) }}/>}
      <section className="container pb-6 pt-3 sm:pb-8 sm:pt-5">
        <HeroCarousel banners={banners} />
        {/* Measures the space above the hero before first paint, so from 1024 px the hero fits the first screen. */}
        <script dangerouslySetInnerHTML={{ __html: HERO_PRE_PAINT_SCRIPT }} />
      </section>

      <TrustRow />

      {categories.length > 0 && <section className="container py-8 sm:py-10" aria-labelledby="categories-title">
        <HomeSectionHeading id="categories-title" eyebrow="BAGATI kataloqu" title="Nə axtarırsan?" href="/categories" />
        <nav aria-label="Məhsul kateqoriyaları" className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-10">
          {orderedCategories.map((category) => (
            <Link key={category.id} href={`/products?category=${encodeURIComponent(category.slug)}`} className="group relative flex min-h-[148px] w-[112px] shrink-0 snap-start flex-col items-center justify-start gap-3 rounded-card border border-line bg-white px-2 pb-3 pt-4 text-center transition-[transform,box-shadow,border-color] duration-200 hover:border-brand-300 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none sm:w-auto sm:min-w-0 after:pointer-events-none after:absolute after:inset-x-5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-gold-400 after:opacity-0 after:transition-opacity after:duration-200 hover:after:opacity-100 motion-reduce:after:transition-none">
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
            <HomeSectionHeading id="stores-title" eyebrow={storesAreFeatured ? "BAGATI seçimi" : "Şəhərinə uyğun"} title={storesAreFeatured ? "Seçilmiş mağazalar" : city?.slug === "qazax" ? "Qazax mağazaları" : city?.name ? `${city.name} mağazaları` : "Mağazalar"} href="/stores">
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
