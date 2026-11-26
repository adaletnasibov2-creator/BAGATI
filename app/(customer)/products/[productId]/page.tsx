import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { categoryHref } from "@/lib/category-tree";
import { notFound } from "next/navigation";
import { ChevronRight, MapPin, MessageCircle, RotateCcw, Store, Truck } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { Prisma } from "@prisma/client";
import ProductVariantPurchase, { PRODUCT_BUY_BAR_SLOT_ID } from "@/components/product-variant-purchase";
import { prisma } from "@/lib/prisma";
import { getSiteSettings } from "@/lib/site-settings";
import { calculateEffectivePrice, productPromotions, type PromotionPriceInput } from "@/lib/promotion-pricing";
import { calculateVariantEffectivePrice } from "@/lib/product-variants";
import { publicProductVisibilityWhere } from "@/lib/store-visibility";
import { requestPublicStoreEligibility } from "@/lib/public-store-eligibility-memo";
import { messageEntryForViewer } from "@/lib/messaging-pages";
import { shortenMetaText } from "@/lib/seo";
import { canonicalMetadata, shareImage, sharePreviewMetadata } from "@/lib/share-preview";
import { productJsonLd, serializeJsonLd } from "@/lib/structured-data";
import { safePublicMapUrl } from "@/lib/store-public-contact";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

type ProductRecord = {
  id: string;
  sku: string | null;
  name: string;
  price: Prisma.Decimal;
  discountPrice: Prisma.Decimal | null;
  description: string | null;
  images: string[];
  store: {
    id: string;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    mapUrl: string | null;
    deliveryFee: Prisma.Decimal;
    freeDeliveryThreshold: Prisma.Decimal;
    city: { name: string };
  };
  category: { name: string; slug: string; isActive: boolean; parent: { name: string; slug: string; isActive: boolean } | null } | null;
  inventory: { variantId: string | null; quantity: number; reserved: number }[];
  variants: {
    id: string;
    name: string;
    options: Record<string, unknown>;
    isActive: boolean;
    price: Prisma.Decimal | null;
    discountPrice: Prisma.Decimal | null;
    images: string[];
    inventory: { variantId: string | null; quantity: number; reserved: number }[];
  }[];
  reviews: { id: string; rating: number; comment: string | null; createdAt: Date }[];
  _count: { reviews: number };
};

/**
 * The page's product query (public visibility filter). Wrapped in React cache so the page and generateMetadata share
 * one database read per request (CART-POLISH + SHARE-PREVIEW).
 */
const getPublicProductRecord = cache((productId: string) =>
  prisma.product.findFirst({
    where: { id: productId, ...publicProductVisibilityWhere() },
    include: {
      store: {
        select: {
          id: true,
          name: true,
          address: true,
          latitude: true,
          longitude: true,
          mapUrl: true,
          deliveryFee: true,
          freeDeliveryThreshold: true,
          city: { select: { name: true } },
        },
      },
      category: { select: { name: true, slug: true, isActive: true, parent: { select: { name: true, slug: true, isActive: true } } } },
      variants: { include: { inventory: true } },
      inventory: true,
      promotionProducts: { include: { promotion: true } },
      reviews: {
        take: 5,
        orderBy: { createdAt: "desc" },
        select: { id: true, rating: true, comment: true, createdAt: true },
      },
      _count: { select: { reviews: true } },
    },
  }));

/**
 * Title, description and share preview (CART-POLISH + SHARE-PREVIEW). The same visibility filter and store
 * eligibility as the page below: a product that is not public returns nothing (the page itself is a 404), so its
 * name and image never reach the head. Only fields the page shows: name, description, the first image.
 */
export async function generateMetadata({ params }: { params: Promise<{ productId: string }> }): Promise<Metadata> {
  const { productId } = await params;
  const product = await getPublicProductRecord(productId) as ProductRecord | null;
  if (!product) return {};
  // CLEANUP-2: the request's store-eligibility memo (React cache), shared with the page below: one read per request.
  const eligibleStoreIds = await requestPublicStoreEligibility().resolve([product.store.id], new Date());
  if (!eligibleStoreIds.has(product.store.id)) return {};
  const settings = await getSiteSettings();
  const description = product.description?.trim() ? shortenMetaText(product.description) : undefined;
  return {
    title: product.name,
    ...(description ? { description } : {}),
    ...sharePreviewMetadata({ title: product.name, description, path: `/products/${product.id}`, siteName: settings.siteName, image: shareImage([product.images[0]], product.name) }),
    // SMALL-FIXES-1 C: rel=canonical = og:url (absolute from APP_BASE_URL).
    ...canonicalMetadata(`/products/${product.id}`),
  };
}

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const now = new Date();
  const [productResult, siteSettings] = await Promise.all([
    getPublicProductRecord(productId),
    getSiteSettings(),
  ]);
  const product = productResult as (ProductRecord & { promotionProducts: { promotion: PromotionPriceInput }[] }) | null;
  if (!product) notFound();

  const eligibleStoreIds = await requestPublicStoreEligibility().resolve([product.store.id], now);
  if (!eligibleStoreIds.has(product.store.id)) notFound();
  // "Bu məhsul haqqında soruş": customers; logged-out visitors sign in first; hidden while messaging is OFF.
  const askHref = await messageEntryForViewer({ storeId: product.store.id, productId: product.id }, "login");
  // SIGNUP-EASY-2: only a signed-in CUSTOMER may get a remembered guest add-to-cart (guests and the edge cache: false).
  const viewer = await currentUser();
  // SEC-FIX-1 L10: the same read-time check as the store page, so a stored non-http(s) link is never rendered.
  const storeMapUrl = safePublicMapUrl(product.store.mapUrl);

  const promotions = productPromotions(product.promotionProducts, product.store.id);
  const effective = calculateEffectivePrice(product.price, product.discountPrice, promotions, now);
  const stock = product.inventory
    .filter(item => item.variantId === null)
    .reduce((sum, item) => sum + Math.max(0, item.quantity - item.reserved), 0);
  const variants = product.variants.map(variant => {
    const price = calculateVariantEffectivePrice({
      productPrice: product.price,
      productDiscountPrice: product.discountPrice,
      variant,
      promotions: product.promotionProducts,
      storeId: product.store.id,
      now,
    });
    const inventory = variant.inventory.find(item => item.variantId === variant.id);
    return {
      id: variant.id,
      name: variant.name,
      options: variant.options,
      isActive: variant.isActive,
      images: variant.images,
      available: inventory ? Math.max(0, inventory.quantity - inventory.reserved) : 0,
      basePrice: price.basePrice.toFixed(2),
      unitPrice: price.unitPrice.toFixed(2),
      campaignName: price.promotion?.name || null,
    };
  });

  // SEO-1: schema.org Product from what this page shows (price, stock, store), only after the 404 checks above.
  // No rating/review/shipping/returns. serializeJsonLd escapes "<" so seller text cannot close the script tag.
  const structuredData = serializeJsonLd(productJsonLd({
    id: product.id,
    name: product.name,
    description: product.description,
    images: product.images,
    sku: product.sku,
    storeName: product.store.name,
    unitPrice: effective.unitPrice.toFixed(2),
    stock,
    variants,
  }));

  // A deactivated category (or a subcategory under a deactivated parent) is hidden publicly: the product stays
  // reachable and purchasable, but its breadcrumb and "Kateqoriya" line do not link to the hidden category.
  const publicCategory = product.category && product.category.isActive && (!product.category.parent || product.category.parent.isActive) ? product.category : null;

  return (
    <div className="container py-6 md:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }}/>
      <nav aria-label="Breadcrumb" className="mb-6 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
        <Link href="/" className="shrink-0 hover:text-primary">Ana səhifə</Link>
        {publicCategory?.parent && <>
          <ChevronRight aria-hidden="true" size={14} className="shrink-0"/>
          <Link href={categoryHref(publicCategory.parent.slug)} className="shrink-0 hover:text-primary">{publicCategory.parent.name}</Link>
        </>}
        {publicCategory ? <>
          <ChevronRight aria-hidden="true" size={14} className="shrink-0"/>
          <Link href={categoryHref(publicCategory.slug)} className="shrink-0 hover:text-primary">{publicCategory.name}</Link>
        </> : <>
          <ChevronRight aria-hidden="true" size={14} className="shrink-0"/>
          <Link href="/products" className="shrink-0 hover:text-primary">Məhsullar</Link>
        </>}
        <ChevronRight aria-hidden="true" size={14} className="shrink-0"/>
        <span aria-current="page" className="min-w-0 truncate text-fg">{product.name}</span>
      </nav>

      <ProductVariantPurchase
        productId={product.id}
        name={product.name}
        productImages={product.images}
        variants={variants}
        hasVariants={product.variants.length > 0}
        stock={stock}
        basePrice={effective.basePrice.toFixed(2)}
        unitPrice={effective.unitPrice.toFixed(2)}
        campaignName={effective.promotion?.name || null}
        store={{
          id: product.store.id,
          name: product.store.name,
          city: product.store.city.name,
          deliveryFee: product.store.deliveryFee.toFixed(2),
          freeDeliveryThreshold: product.store.freeDeliveryThreshold.toFixed(2),
        }}
        category={publicCategory ? {
          name: publicCategory.name,
          href: categoryHref(publicCategory.slug),
        } : null}
        viewerIsCustomer={viewer?.role === "CUSTOMER"}
        sku={product.sku}
      />

      <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
        <section className="rounded-feature border border-line bg-white p-5 sm:p-7" aria-labelledby="product-description-title">
          <p className="text-kicker uppercase text-gold-700">Məhsul haqqında</p>
          <h2 id="product-description-title" className="mt-2 font-display text-h2 text-fg">Təsvir və məlumat</h2>
          <p className="mt-4 max-w-[68ch] whitespace-pre-wrap break-words text-body-lg leading-8 text-fg-body">
            {product.description || "Satıcı bu məhsul üçün əlavə təsvir təqdim etməyib."}
          </p>
          {publicCategory && <p className="mt-6 border-t border-line pt-4 text-sm text-fg-secondary">
            Kateqoriya: {publicCategory.parent && <><Link href={categoryHref(publicCategory.parent.slug)} className="font-medium text-fg hover:text-primary">{publicCategory.parent.name}</Link>{" › "}</>}<Link href={categoryHref(publicCategory.slug)} className="font-medium text-fg hover:text-primary">{publicCategory.name}</Link>
          </p>}
        </section>

        <section className="rounded-feature border border-line bg-white p-5 sm:p-7" aria-labelledby="product-store-title">
          <p className="text-kicker uppercase text-gold-700">Satıcı mağazası</p>
          <Link id="product-store-title" href={`/stores/${product.store.id}`} className="mt-3 flex min-h-11 items-center gap-3 rounded-control font-display text-h3 text-fg hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-subtle text-primary ring-1 ring-inset ring-brand-100"><Store size={19}/></span>
            <span className="min-w-0 break-words">{product.store.name}</span>
          </Link>
          <p className="mt-3 flex items-start gap-2 text-sm text-fg-secondary">
            <MapPin aria-hidden="true" size={16} className="mt-0.5 shrink-0"/>
            <span>{product.store.city.name}{product.store.address ? ` · ${product.store.address}` : ""}</span>
          </p>
          {product.store.latitude !== null && product.store.longitude !== null ? (
            <iframe
              title={`${product.store.name} xəritə mövqeyi`}
              loading="lazy"
              className="mt-5 h-48 w-full rounded-card border-0"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${product.store.longitude - 0.01}%2C${product.store.latitude - 0.01}%2C${product.store.longitude + 0.01}%2C${product.store.latitude + 0.01}&layer=mapnik&marker=${product.store.latitude}%2C${product.store.longitude}`}
            />
          ) : <p className="mt-5 rounded-control bg-surface-page p-3 text-xs text-fg-muted">Mağaza xəritə mövqeyini hələ əlavə etməyib.</p>}
          {storeMapUrl && <a href={storeMapUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-primary hover:text-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus mt-3">Mağaza xəritəsinə bax →</a>}
          {askHref && <Link href={askHref} className={`mt-4 ${buttonClass({ variant: "secondary", size: "sm", fullWidth: true })}`}><MessageCircle aria-hidden="true" size={17}/>Bu məhsul haqqında soruş</Link>}
        </section>
      </div>

      <section className="mt-5 grid gap-5 md:grid-cols-2" aria-label="Çatdırılma və qaytarılma məlumatı">
        <article className="rounded-card border border-line bg-surface-page p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold text-fg"><Truck aria-hidden="true" size={18} className="text-primary"/>Çatdırılma məlumatı</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-fg-secondary">{siteSettings.deliveryInfo || "Çatdırılma şərtləri sifariş və mağazaya görə göstərilir."}</p>
          <Link href="/delivery-returns" className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-primary hover:text-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus mt-2">Ətraflı məlumat →</Link>
        </article>
        <article className="rounded-card border border-line bg-surface-page p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-base font-semibold text-fg"><RotateCcw aria-hidden="true" size={18} className="text-primary"/>Qaytarılma məlumatı</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-fg-secondary">{siteSettings.returnsInfo || "Qaytarılma barədə məlumat mövcud deyil."}</p>
          <Link href="/delivery-returns" className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-primary hover:text-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus mt-2">Ətraflı məlumat →</Link>
        </article>
      </section>

      {/* Customer reviews only when real reviews exist (DESIGN-T7 fix c): no empty section, no rating claim. */}
      {product.reviews.length > 0 && <section className="mt-8 rounded-feature border border-line bg-white p-5 sm:p-7" aria-labelledby="product-reviews-title">
        <div>
          <p className="text-kicker uppercase text-gold-700">Alıcı rəyləri</p>
          <h2 id="product-reviews-title" className="mt-2 font-display text-h2 text-fg">
            Rəylər <span className="font-sans text-sm font-normal text-fg-muted">({product._count.reviews})</span>
          </h2>
        </div>
        <div className="mt-5 divide-y divide-line">
            {product.reviews.map(review => (
              <article key={review.id} className="py-4 first:pt-0">
                <p className="text-sm tracking-widest text-gold-700" aria-label={`${review.rating} / 5`}>
                  {"★".repeat(review.rating)}<span className="text-line-strong">{"★".repeat(Math.max(0, 5 - review.rating))}</span>
                </p>
                <p className="mt-2 text-sm leading-6 text-fg-body">{review.comment || "Mətnsiz rəy"}</p>
                <time className="mt-2 block text-xs text-fg-muted" dateTime={review.createdAt.toISOString()}>{review.createdAt.toLocaleDateString("az-AZ")}</time>
              </article>
            ))}
        </div>
      </section>}

      {/* Mobile buy bar slot (DESIGN-T6): sticky above the mobile bottom nav (<768 px), at the screen bottom at 768-1023 px,
          hidden from 1024 px. Its height is reserved, so the portalled bar causes no layout shift; being sticky (not
          fixed) it rests here, before the footer, at the end of the page. */}
      <div id={PRODUCT_BUY_BAR_SLOT_ID} className="sticky bottom-[calc(62px+env(safe-area-inset-bottom))] z-30 -mx-[14px] mt-8 min-h-[76px] border-t border-line bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(23,58,58,0.08)] backdrop-blur sm:-mx-7 sm:px-7 md:bottom-0 lg:hidden"/>
    </div>
  );
}
