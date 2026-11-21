import Image from "next/image";
import Link from "next/link";
import { StoreHoursDot } from "@/components/store-hours-dot";
import { storeHoursOf } from "@/lib/store-hours";

type StripStore = { id: string; name: string; logoUrl: string | null; city: { name: string }; openingTime?: string | null; closingTime?: string | null };

/**
 * Stores as round avatar cards (design T5): the logo in a circle, or the store's initial on a soft green disc.
 * Uses the stores the home page already loads (featured stores, else stores of the active city); no extra query.
 * Scrolls sideways on phones, a grid from sm.
 */
export function StoreStrip({ stores }: { stores: StripStore[] }) {
  return (
    <ul className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0">
      {stores.map((store) => { const hours = storeHoursOf(store); return (
        <li key={store.id} className="w-[44%] shrink-0 snap-start sm:w-auto">
          <Link href={`/stores/${store.id}`} className="group flex h-full flex-col items-center rounded-card border border-line bg-white px-3 pb-4 pt-5 text-center transition-[transform,box-shadow,border-color] duration-200 hover:border-brand-200 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none">
            <span className="relative grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-full bg-primary-subtle ring-1 ring-brand-100 ring-offset-2 ring-offset-white">
              {store.logoUrl
                ? <Image src={store.logoUrl} alt="" fill sizes="72px" unoptimized={/^https?:\/\//i.test(store.logoUrl)} className="object-cover" />
                : <span aria-hidden="true" className="font-serif text-[1.75rem] font-medium text-primary">{store.name.trim().charAt(0).toLocaleUpperCase("az")}</span>}
            </span>
            <span className="mt-3 flex min-h-10 max-w-full items-start justify-center gap-1.5">
              <span className="line-clamp-2 min-w-0 text-sm font-semibold leading-5 text-fg group-hover:text-primary">{store.name}</span>
              {hours && <StoreHoursDot openingTime={hours.openingTime} closingTime={hours.closingTime} className="mt-[5px]"/>}
            </span>
            <span className="mt-0.5 text-xs text-fg-muted">{store.city.name}</span>
          </Link>
        </li>
      ); })}
    </ul>
  );
}
