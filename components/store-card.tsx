import Image from "next/image";
import Link from "next/link";
import { MapPin, MapPinned, Store } from "lucide-react";

type StoreCardProps = { id: string; name: string; city: string; description?: string | null; logoUrl?: string | null; hasLocation?: boolean };

export function StoreCard({ id, name, city, description, logoUrl, hasLocation }: StoreCardProps) {
  return <Link href={`/stores/${id}`} className="group flex min-w-0 gap-3 rounded-[18px] border border-[#E4E8E4] bg-white p-3.5 shadow-[0_8px_22px_rgba(23,58,58,.04)] transition hover:-translate-y-0.5 hover:border-[#C9D8D1] hover:shadow-card sm:gap-4 sm:p-4">
    <div className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#EFF4F1] text-[#638078]">{logoUrl ? <Image src={logoUrl} alt={`${name} loqosu`} fill unoptimized={/^https?:\/\//i.test(logoUrl)} sizes="56px" className="object-cover"/> : <Store aria-hidden="true" size={22}/>}</div>
    <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><h3 className="truncate text-sm font-semibold text-[#24413D] group-hover:text-[#2F6F68]">{name}</h3>{hasLocation&&<span title="Xəritə mövqeyi mövcuddur" className="shrink-0 text-[#2F6F68]"><MapPinned aria-label="Xəritə mövqeyi mövcuddur" size={16}/></span>}</div><p className="mt-1 flex items-center gap-1 text-xs text-[#75817F]"><MapPin aria-hidden="true" size={13}/>{city}<span aria-hidden="true">·</span><span>Aktiv mağaza</span></p>{description && <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#697875]">{description}</p>}</div>
  </Link>;
}
