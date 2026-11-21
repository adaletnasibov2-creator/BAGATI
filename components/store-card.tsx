import Image from "next/image";
import Link from "next/link";
import { MapPin, MapPinned } from "lucide-react";
import { StoreHoursDot } from "@/components/store-hours-dot";
import { storeHoursOf } from "@/lib/store-hours";

type StoreCardProps = { id: string; name: string; city: string; description?: string | null; logoUrl?: string | null; hasLocation?: boolean; openingTime?: string | null; closingTime?: string | null };

/**
 * Store card on /stores, aligned with the store page header (DESIGN-T7): logo with the same initial-letter fallback,
 * Fraunces name, token colours, 20 px radius and a visible focus ring. Same data and texts as before.
 */
export function StoreCard({ id, name, city, description, logoUrl, hasLocation, openingTime, closingTime }: StoreCardProps) {
  const hours = storeHoursOf({ openingTime, closingTime });
  const initial = name.trim().slice(0, 1).toLocaleUpperCase("az-AZ") || "M";
  return <Link href={`/stores/${id}`} className="group flex min-w-0 gap-3 rounded-card border border-line bg-white p-4 shadow-subtle transition-[transform,box-shadow,border-color] duration-200 hover:border-brand-200 hover:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-safe:hover:-translate-y-0.5 motion-reduce:transition-none sm:gap-4">
    <div className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-control border border-line bg-surface-page sm:h-16 sm:w-16">
      {logoUrl
        ? <Image src={logoUrl} alt={`${name} loqosu`} fill unoptimized={/^https?:\/\//i.test(logoUrl)} sizes="64px" className="object-contain p-1"/>
        : <span aria-hidden="true" className="font-display text-xl font-semibold text-primary">{initial}</span>}
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate font-display text-base font-semibold text-fg group-hover:text-primary">{name}</h3>
          {hours && <StoreHoursDot openingTime={hours.openingTime} closingTime={hours.closingTime}/>}
        </div>
        {hasLocation && <span title="Xəritə mövqeyi mövcuddur" className="shrink-0 text-primary"><MapPinned aria-label="Xəritə mövqeyi mövcuddur" size={16}/></span>}
      </div>
      <p className="mt-1 flex items-center gap-1 text-xs text-fg-muted"><MapPin aria-hidden="true" size={13}/>{city}<span aria-hidden="true">·</span><span>Aktiv mağaza</span></p>
      {description && <p className="mt-2 line-clamp-2 text-xs leading-5 text-fg-secondary">{description}</p>}
    </div>
  </Link>;
}
