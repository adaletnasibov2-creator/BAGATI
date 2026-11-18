import { PRODUCT_GRID_WITH_SIDEBAR_CLASS } from "@/components/product-layout";
import { ProductCardSkeleton } from "@/components/product-card";
import { Skeleton, SkeletonRegion, SkeletonText } from "@/components/ui/skeleton";

/**
 * Product list while the server renders it: title, filter bar, category sidebar (from lg) and a card grid with the
 * page's own columns. The (list) route group keeps it off the product detail pages (/products/[productId]).
 */
export default function ProductListLoading() {
  return <SkeletonRegion label="Məhsullar yüklənir…" className="container py-10 md:py-14">
    <Skeleton rounded="full" className="h-3 w-28" />
    <Skeleton rounded="full" className="mt-3 h-9 w-72 max-w-full md:h-10" />
    <div className="mt-7 grid gap-3 rounded-2xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
      {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12" />)}
    </div>
    <Skeleton className="mt-5 h-11 lg:hidden" />
    <div className="lg:mt-8 lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-6">
      <div className="hidden rounded-2xl border border-line bg-white p-4 lg:block">
        <SkeletonText lines={8} />
      </div>
      <div className={`mt-8 lg:mt-0 ${PRODUCT_GRID_WITH_SIDEBAR_CLASS}`}>
        {Array.from({ length: 8 }, (_, index) => <ProductCardSkeleton key={index} />)}
      </div>
    </div>
  </SkeletonRegion>;
}
