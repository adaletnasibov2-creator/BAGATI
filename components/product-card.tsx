import Link from "next/link";
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
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-bagati-border bg-white transition-[border-color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:border-[#C9D8D1] hover:shadow-[0_16px_38px_rgba(23,58,58,.1)] motion-reduce:transform-none motion-reduce:transition-none">
      <div className="relative">
        <Link
          href={`/products/${id}`}
          aria-label={`${name} məhsuluna bax`}
          className="relative block aspect-[4/5] overflow-hidden bg-bagati-page focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-bagati-gold"
        >
          <ProductCardImage
            src={image}
            secondarySrc={secondaryImage}
            alt={name}
            sizes="(min-width: 1024px) 23vw, (min-width: 768px) 31vw, (min-width: 640px) 46vw, 48vw"
          />
        </Link>
        {badgeLabel && (
          <span
            className={`absolute left-3 right-14 top-3 w-fit max-w-[calc(100%-4.5rem)] truncate rounded-full border border-white/60 px-2.5 py-1.5 text-[.65rem] font-semibold shadow-sm backdrop-blur ${
              discounted || campaignName
                ? "bg-[#F3E9D5] text-[#70552E]"
                : "bg-white/95 text-[#315A51]"
            }`}
          >
            {badgeLabel}
          </span>
        )}
        <div className="absolute right-3 top-3">
          <FavoriteToggle productId={id} />
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        {campaignName && (
          <p className="mb-1 truncate text-[.68rem] font-medium text-bagati-gold-dark">{campaignName}</p>
        )}
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
          className="mt-1.5 min-h-10 line-clamp-2 text-sm font-semibold leading-5 text-bagati-text hover:text-bagati-accent focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-bagati-gold"
        >
          {name}
        </Link>
        {variantCount !== undefined && variantCount > 0 && (
          <p className="mt-1 text-xs text-bagati-muted">
            {variantCount} variant seçimi
          </p>
        )}

        <div className="mt-auto flex min-h-10 flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-3">
          <p className="text-base font-semibold tracking-tight text-bagati-deep sm:text-lg">
            {price} ₼
          </p>
          {discounted && (
            <del className="text-xs text-bagati-muted">
              <span className="sr-only">Əvvəlki qiymət: </span>
              {originalPrice} ₼
            </del>
          )}
        </div>
        <div className="min-h-5 pt-1">
          {stock !== undefined &&
            stock > 0 &&
            lowStockThreshold !== undefined &&
            stock <= lowStockThreshold && (
              <p className="inline-flex items-center gap-1.5 text-xs font-medium text-bagati-gold-dark">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-bagati-gold" />
                Az sayda qalıb
              </p>
            )}
        </div>
        <div className="mt-2">
          <QuickAddToCart productId={id} stock={stock} />
        </div>
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <article aria-hidden="true" className="flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-bagati-border bg-white">
      <div className="bagati-skeleton aspect-[4/5]" />
      <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
        <div className="bagati-skeleton h-3 w-2/5 rounded-full" />
        <div className="bagati-skeleton h-4 w-full rounded-full" />
        <div className="bagati-skeleton h-4 w-3/4 rounded-full" />
        <div className="mt-auto bagati-skeleton h-6 w-1/2 rounded-full" />
        <div className="bagati-skeleton mt-2 h-11 w-full rounded-xl" />
      </div>
    </article>
  );
}
