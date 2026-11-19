import { PRODUCT_SHELF_TRACK_CLASS } from "@/components/product-layout";
import { ProductCardSkeleton } from "@/components/product-card";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";

/**
 * Home page while the server renders it, in the same sizes as the real page (design T5): the hero (image strip plus
 * the reserved text panel below 1024 px, from 1024 px one block as tall as the real hero, --bagati-hero-h), the trust
 * row, the category cards and one product shelf. The (home) route group keeps this skeleton to "/" only; a loading.tsx directly in (customer)
 * would also show on every other customer page.
 */
export default function HomeLoading() {
  return <SkeletonRegion label="Ana səhifə yüklənir…" className="overflow-hidden bg-bagati-page">
    <div className="container pb-6 pt-3 sm:pb-8 sm:pt-5">
      <div className="bagati-hero overflow-hidden rounded-feature bg-brand-900 lg:relative lg:h-[var(--bagati-hero-h)]">
        <Skeleton rounded="none" className="aspect-[4/3] w-full opacity-60 sm:aspect-[2/1] lg:absolute lg:inset-y-0 lg:right-0 lg:aspect-auto lg:w-[56%]" />
        <div className="grid min-h-[404px] content-center gap-4 p-5 sm:p-8 lg:h-full lg:min-h-0 lg:w-[46%] lg:px-9 xl:px-11">
          <Skeleton rounded="full" className="h-3 w-28 opacity-30" />
          <Skeleton className="h-10 w-4/5 opacity-30" />
          <Skeleton className="h-10 w-3/5 opacity-30" />
          <Skeleton rounded="full" className="mt-2 h-12 w-44 opacity-30" />
        </div>
      </div>
    </div>
    <div className="container pb-2 pt-1 sm:pb-4">
      <div className="grid gap-4 border-t border-gold-200 pt-5 sm:grid-cols-3 sm:gap-6 sm:pt-6">
        {Array.from({ length: 3 }, (_, index) => <div key={index} className="flex items-center gap-3"><Skeleton rounded="full" className="h-10 w-10 shrink-0" /><Skeleton rounded="full" className="h-4 w-3/4" /></div>)}
      </div>
    </div>
    <div className="container py-8 sm:py-10">
      <Skeleton rounded="full" className="h-3 w-28" />
      <Skeleton className="mt-3 h-8 w-56" />
      <div className="-mx-3 mt-6 flex gap-3 overflow-hidden px-3 pb-2 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-4 sm:px-0 lg:grid-cols-10">
        {Array.from({ length: 10 }, (_, index) => <Skeleton key={index} rounded="card" className="h-[148px] w-[112px] shrink-0 sm:w-auto" />)}
      </div>
    </div>
    <div className="container py-8 sm:py-10">
      <Skeleton rounded="full" className="h-3 w-24" />
      <Skeleton className="mt-3 h-8 w-64" />
      <div className={`mt-6 overflow-hidden ${PRODUCT_SHELF_TRACK_CLASS}`}>
        {Array.from({ length: 5 }, (_, index) => <ProductCardSkeleton key={index} />)}
      </div>
    </div>
  </SkeletonRegion>;
}
