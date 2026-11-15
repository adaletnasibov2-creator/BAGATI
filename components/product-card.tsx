import Link from "next/link";
import { PRODUCT_CARD_IMAGE_SIZES } from "@/components/product-layout";
import { FavoriteToggle } from "@/components/favorite-toggle";
import ProductCardImage from "@/components/product-card-image";
import { QuickAddToCart } from "@/components/quick-add-to-cart";
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

export function ProductCard({ id, name, price, originalPrice, store, storeHref, storeIsPro, campaignName, discountLabel, image, secondaryImage, badge, stock, lowStockThreshold, variantCount }: ProductCardProps) {
  const { discounted, percentOff } = getProductDiscount(price, originalPrice);
  const badgeLabel = discounted
    ? discountLabel || (percentOff ? `−${percentOff}%` : "Endirim")
    : campaignName
      ? discountLabel || "Kampaniya"
      : badge;

  return (
    // relative: contains every sr-only (position:absolute) text of the card, so a card scrolled out of a carousel never widens the page.
    <article className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-[18px] border border-bagati-border bg-white transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-[#C9D8D1] hover:shadow-[0_16px_38px_rgba(23,58,58,.1)] motion-reduce:transform-none motion-reduce:transition-none">
      <div className="relative">
        <Link
          href={`/products/${id}`}
          aria-label={`${name} məhsuluna bax`}
          className="relative block aspect-square overflow-hidden bg-white focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-bagati-gold"
        >
          <ProductCardImage
            src={image}
            secondarySrc={secondaryImage}
            alt={name}
            sizes={PRODUCT_CARD_IMAGE_SIZES}
          />
        </Link>
        {badgeLabel && (
          <span
            className={`absolute left-2 right-12 top-2 w-fit max-w-[calc(100%-3.5rem)] truncate rounded-full border border-white/60 px-2 py-1 text-[.62rem] font-semibold shadow-sm backdrop-blur sm:left-2.5 sm:top-2.5 ${
              discounted || campaignName
                ? "bg-[#F3E9D5] text-[#70552E]"
                : "bg-white/95 text-[#315A51]"
            }`}
          >
            {badgeLabel}
          </span>
        )}
        <div className="absolute right-2 top-2 sm:right-2.5 sm:top-2.5">
          <FavoriteToggle productId={id} />
        </div>
      </div>

      <div className="flex flex-1 flex-col border-t border-bagati-border/70 p-2.5 sm:p-3">
        <div className="flex min-h-5 items-center justify-between gap-2">
          {storeHref ? (
            <Link
              href={storeHref}
              className="min-w-0 truncate text-xs font-medium text-bagati-muted hover:text-bagati-accent focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold sm:text-[.8rem]"
            >
              {store}
            </Link>
          ) : (
            <p className="min-w-0 truncate text-xs font-medium text-bagati-muted sm:text-[.8rem]">
              {store}
            </p>
          )}
          {storeIsPro && (
            <span className="shrink-0 rounded-full bg-bagati-section px-2 py-0.5 text-[.58rem] font-semibold text-bagati-text">
              PRO mağaza
            </span>
          )}
        </div>
        <Link
          href={`/products/${id}`}
          className="mt-1 line-clamp-2 min-h-10 text-[.82rem] font-semibold leading-5 text-bagati-text hover:text-bagati-accent sm:text-sm focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold"
        >
          {name}
        </Link>
        {/* Fixed one-line slot (variant count and/or campaign), so the price sits at the same height in every card of a row. */}
        <p className="mt-0.5 h-4 truncate text-[.7rem] leading-4 text-bagati-muted">
          {variantCount !== undefined && variantCount > 0 ? `${variantCount} variant seçimi` : null}
          {variantCount !== undefined && variantCount > 0 && campaignName ? " · " : null}
          {campaignName ? <span className="font-medium text-bagati-gold-dark">{campaignName}</span> : null}
        </p>

        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0">
          <p className="text-[.95rem] font-semibold tracking-tight text-bagati-deep sm:text-base">
            {price} ₼
          </p>
          {discounted && (
            <del className="text-xs text-bagati-muted">
              <span className="sr-only">Əvvəlki qiymət: </span>
              {originalPrice} ₼
            </del>
          )}
        </div>
        {stock !== undefined && stock > 0 && lowStockThreshold !== undefined && stock <= lowStockThreshold && (
          <p className="mt-0.5 inline-flex items-center gap-1.5 text-[.7rem] font-medium text-bagati-gold-dark">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-bagati-gold" />
            Az sayda qalıb
          </p>
        )}
        {/* mt-auto: the button is the last thing in the card, at the same height across a row. */}
        <div className="mt-auto pt-2.5">
          <QuickAddToCart productId={id} stock={stock} />
        </div>
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <article aria-hidden="true" className="flex h-full min-w-0 flex-col overflow-hidden rounded-[18px] border border-bagati-border bg-white">
      <div className="bagati-skeleton aspect-square" />
      <div className="flex flex-1 flex-col gap-2.5 p-2.5 sm:p-3">
        <div className="bagati-skeleton h-3 w-2/5 rounded-full" />
        <div className="bagati-skeleton h-4 w-full rounded-full" />
        <div className="bagati-skeleton h-4 w-3/4 rounded-full" />
        <div className="mt-auto bagati-skeleton h-6 w-1/2 rounded-full" />
        <div className="bagati-skeleton mt-2 h-11 w-full rounded-xl" />
      </div>
    </article>
  );
}
