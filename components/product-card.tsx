"use client";

// A client component since SCALE-FIX-3 (B2): the server sends each card's props (about 0.3 KB) instead of its rendered
// element tree with every class string (about 2.9 KB per card, 140 KB of payload for the 48 cards of /products). The
// HTML is the same. The card code was already in the browser bundle (the favourites page renders it).
import Link from "next/link";
import { PRODUCT_CARD_IMAGE_SIZES } from "@/components/product-layout";
import { FavoriteToggle } from "@/components/favorite-toggle";
import ProductCardImage from "@/components/product-card-image";
import { QuickAddToCart } from "@/components/quick-add-to-cart";
import { badgeClass } from "@/components/ui/badge";
import { cx } from "@/components/ui/cx";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { getProductDiscount } from "@/lib/product-card-pricing";

type ProductCardProps = {
  id: string;
  name: string;
  price: string;
  store: string;
  storeHref?: string;
  storeIsPro?: boolean;
  campaignName?: string | null;
  discountLabel?: string | null;
  image?: string | null;
  secondaryImage?: string | null;
  originalPrice?: string | null;
  badge?: "Yeni" | null;
  stock?: number;
  lowStockThreshold?: number;
  variantCount?: number;
};

/** In-card focus ring: 2 px primary green drawn inside the element (cards clip overflow). */
const insetFocus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-focus";

/**
 * The one product card of the public site (home shelves, /products and search, /categories, /deals,
 * /new-products, store pages, favourites). Design T3: calmer type in Inter (Fraunces is for headings only),
 * the current price strongest, the old price struck through and muted, a gold discount badge, a reserved square
 * image, a CSS-only hover lift and the pill "Səbətə əlavə et" action that the card already had.
 */
export function ProductCard({ id, name, price, originalPrice, store, storeHref, storeIsPro, campaignName, discountLabel, image, secondaryImage, badge, stock, lowStockThreshold, variantCount }: ProductCardProps) {
  const { discounted, percentOff } = getProductDiscount(price, originalPrice);
  const badgeLabel = discounted
    ? discountLabel || (percentOff ? `−${percentOff}%` : "Endirim")
    : campaignName
      ? discountLabel || "Kampaniya"
      : badge;

  return (
    // relative: contains every sr-only (position:absolute) text of the card, so a card scrolled out of a carousel never widens the page.
    <article className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-card border border-line bg-white transition-[border-color,box-shadow,transform] duration-200 ease-out hover:border-brand-200 hover:shadow-card motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none">
      <div className="relative">
        <Link
          href={`/products/${id}`}
          aria-label={`${name} məhsuluna bax`}
          className="relative block aspect-square overflow-hidden bg-white focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-focus"
        >
          <ProductCardImage
            src={image}
            secondarySrc={secondaryImage}
            alt={name}
            sizes={PRODUCT_CARD_IMAGE_SIZES}
          />
        </Link>
        {badgeLabel && (
          <span className={cx("absolute left-2 top-2 max-w-[calc(100%-3.75rem)] truncate font-semibold shadow-subtle sm:left-2.5 sm:top-2.5", badgeClass(discounted || campaignName ? "gold" : "primary"))}>
            {badgeLabel}
          </span>
        )}
        <div className="absolute right-2 top-2 sm:right-2.5 sm:top-2.5">
          <FavoriteToggle productId={id} />
        </div>
      </div>

      <div className="flex flex-1 flex-col border-t border-line p-3 sm:p-3.5">
        <div className="flex min-h-5 items-center justify-between gap-2">
          {storeHref ? (
            <Link
              href={storeHref}
              className={cx("min-w-0 truncate rounded-sm text-xs font-medium text-fg-muted transition-colors hover:text-primary", insetFocus, "focus-visible:outline-offset-0")}
            >
              {store}
            </Link>
          ) : (
            <p className="min-w-0 truncate text-xs font-medium text-fg-muted">
              {store}
            </p>
          )}
          {storeIsPro && (
            <span className={cx("shrink-0", badgeClass("neutral"))}>
              PRO mağaza
            </span>
          )}
        </div>
        <Link
          href={`/products/${id}`}
          className={cx("mt-1 line-clamp-2 min-h-10 rounded-sm text-sm font-medium leading-5 text-fg transition-colors hover:text-primary", insetFocus, "focus-visible:outline-offset-0")}
        >
          {name}
        </Link>
        {/* Fixed one-line slot (variant count and/or campaign), so the price sits at the same height in every card of a row. */}
        <p className="mt-1 h-[1.125rem] truncate text-xs leading-[1.125rem] text-fg-muted">
          {variantCount !== undefined && variantCount > 0 ? `${variantCount} variant seçimi` : null}
          {variantCount !== undefined && variantCount > 0 && campaignName ? " · " : null}
          {campaignName ? <span className="font-medium text-gold-700">{campaignName}</span> : null}
        </p>

        {/* Phones: the old price on its own line, so long prices never wrap differently across a row. */}
        <div className="mt-2 flex flex-col gap-y-0 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
          <p className="text-base font-bold tabular-nums tracking-tight text-fg sm:text-[1.0625rem]">
            {price} ₼
          </p>
          {discounted && (
            <del className="text-xs tabular-nums text-fg-muted">
              <span className="sr-only">Əvvəlki qiymət: </span>
              {originalPrice} ₼
            </del>
          )}
        </div>
        {stock !== undefined && stock > 0 && lowStockThreshold !== undefined && stock <= lowStockThreshold && (
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-gold-700">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-gold-400" />
            Az sayda qalıb
          </p>
        )}
        {/* mt-auto: the button is the last thing in the card, at the same height across a row. */}
        <div className="mt-auto pt-3">
          <QuickAddToCart productId={id} stock={stock} />
        </div>
      </div>
    </article>
  );
}

/** Same frame as ProductCard (square image, text lines, price, button), for loading.tsx and client loading states. */
export function ProductCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-full min-w-0 flex-col overflow-hidden rounded-card border border-line bg-white">
      <Skeleton rounded="none" className="aspect-square" />
      <div className="flex flex-1 flex-col gap-2.5 border-t border-line p-3 sm:p-3.5">
        <Skeleton rounded="full" className="h-3 w-2/5" />
        <SkeletonText lines={2} />
        <Skeleton rounded="full" className="h-5 w-1/2" />
        <Skeleton rounded="full" className="mt-auto h-11 w-full" />
      </div>
    </div>
  );
}
