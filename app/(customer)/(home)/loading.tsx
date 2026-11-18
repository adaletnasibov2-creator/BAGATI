import { PRODUCT_SHELF_TRACK_CLASS } from "@/components/product-layout";
import { Skeleton, SkeletonRegion, SkeletonText } from "@/components/ui/skeleton";

/**
 * Home page while the server renders it: hero, category row and one product shelf, in the page's own sizes
 * (the hero uses the carousel's aspect ratios). The (home) route group keeps this skeleton to "/" only;
 * a loading.tsx directly in (customer) would also show on every other customer page.
 */
export default function HomeLoading() {
  return <SkeletonRegion label="Ana səhifə yüklənir…" className="overflow-hidden bg-bagati-page">
    <div className="container pb-6 pt-3 sm:pb-8 sm:pt-5">
      <Skeleton rounded="card" className="aspect-[4/3] w-full sm:aspect-[2/1] lg:aspect-[5/2]" />
    </div>
    <div className="container pb-4 pt-2 sm:pb-6">
      <Skeleton rounded="full" className="h-3 w-28" />
      <Skeleton rounded="full" className="mt-2 h-7 w-56" />
      <div className="-mx-3 mt-4 flex gap-2.5 overflow-hidden px-3 pb-2 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-3 sm:px-0 lg:grid-cols-10">
        {Array.from({ length: 10 }, (_, index) => <Skeleton key={index} rounded="card" className="h-[142px] min-w-[108px] shrink-0" />)}
      </div>
    </div>
    <div className="container py-6 sm:py-8">
      <Skeleton rounded="full" className="h-3 w-24" />
      <Skeleton rounded="full" className="mt-2 h-7 w-64" />
      <div className={`mt-4 overflow-hidden ${PRODUCT_SHELF_TRACK_CLASS}`}>
        {Array.from({ length: 5 }, (_, index) => <ProductCardPlaceholder key={index} />)}
      </div>
    </div>
  </SkeletonRegion>;
}

function ProductCardPlaceholder() {
  return <div className="flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-bagati-border bg-white">
    <Skeleton rounded="none" className="aspect-square" />
    <div className="grid gap-2.5 p-2.5 sm:p-3">
      <Skeleton rounded="full" className="h-3 w-2/5" />
      <SkeletonText lines={2} />
      <Skeleton rounded="full" className="h-5 w-1/2" />
      <Skeleton className="h-11 w-full" />
    </div>
  </div>;
}
