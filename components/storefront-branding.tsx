import Link from "next/link";
import { Mail, MapPin, Phone, Store } from "lucide-react";
import StorefrontImage from "@/components/storefront-image";
import { getStorefrontTheme } from "@/lib/storefront-themes";

export type StorefrontBrand = {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  theme: string;
  city: { name: string };
  contactPhone: string | null;
  contactEmail: string | null;
};

export default function StorefrontBranding({ store, categoryCount }: { store: StorefrontBrand; categoryCount: number }) {
  const colors = getStorefrontTheme(store.theme);
  const initial = store.name.trim().slice(0, 1).toLocaleUpperCase("az-AZ") || "M";

  return <header id="top" className="overflow-hidden rounded-[26px] border border-line bg-white shadow-[0_12px_36px_rgba(23,58,58,.07)]">
    <div className="relative isolate h-36 overflow-hidden sm:h-48" style={{ backgroundColor: colors.accentSoft }}>
      {store.bannerUrl
        ? <StorefrontImage src={store.bannerUrl} alt={`${store.name} mağazasının örtük şəkli`} className="absolute inset-0 h-full w-full object-cover" fill sizes="100vw" priority fallback={<div className="absolute inset-0 bg-gradient-to-br from-[#dce8df] to-[#f2ead8]"/>}/>
        : <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-gradient-to-br from-[#dce8df] via-[#eef1e8] to-[#f2ead8]">
          <div className="absolute -right-8 -top-24 h-64 w-64 rounded-full border-[36px] opacity-30" style={{ borderColor: colors.highlight }}/>
          <div className="absolute -bottom-24 left-[28%] h-48 w-48 rounded-full opacity-20" style={{ backgroundColor: colors.accent }}/>
          <div className="absolute bottom-5 left-5 flex items-center gap-2 text-xs font-semibold tracking-[.18em] sm:left-8" style={{ color: colors.accent }}><Store size={15}/> BAGATI MAĞAZASI</div>
        </div>}
      {store.bannerUrl && <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#122E2E]/40 via-transparent to-[#122E2E]/5"/>}
    </div>
    <div className="px-5 pb-5 sm:px-8 sm:pb-7">
      <div className="-mt-9 flex flex-col gap-4 sm:-mt-11 sm:flex-row sm:items-end sm:gap-5">
        <div className="relative grid h-[76px] w-[76px] shrink-0 place-items-center overflow-hidden rounded-2xl border-4 border-white bg-white shadow-md sm:h-24 sm:w-24">
          <StorefrontImage
            src={store.logoUrl}
            alt={`${store.name} loqosu`}
            className="h-full w-full object-contain p-2"
            fallback={<span className="grid h-full w-full place-items-center text-3xl font-semibold" style={{ color: colors.accent, backgroundColor: colors.accentSoft }}>{initial}</span>}
          />
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <p className="flex items-center gap-1.5 text-sm text-muted"><MapPin size={15} aria-hidden="true"/>{store.city.name}</p>
          <h1 className="mt-1 break-words text-2xl font-semibold text-ink sm:text-3xl">{store.name}</h1>
          {store.description && <p className="mt-2 max-w-3xl whitespace-pre-line text-sm leading-6 text-muted">{store.description}</p>}
        </div>
        {(store.contactPhone || store.contactEmail) && <div id="store-contact" className="flex flex-wrap gap-2 sm:max-w-64 sm:justify-end">
          {store.contactPhone && <a href={`tel:${store.contactPhone}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]" style={{ backgroundColor: colors.accent }}><Phone size={15} aria-hidden="true"/> Zəng et</a>}
          {store.contactEmail && <a href={`mailto:${store.contactEmail}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]" style={{ color: colors.accent, borderColor: colors.accent }}><Mail size={15} aria-hidden="true"/> E-poçt</a>}
        </div>}
      </div>
      <nav aria-label="Mağaza bölmələri" className="mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-sm font-medium">
        <a href="#store-products" className="inline-flex min-h-11 items-center hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]" style={{ color: colors.accent }}>Məhsullar</a>
        {categoryCount > 0 && <a href="#store-categories" className="inline-flex min-h-11 items-center text-muted hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]">Kateqoriyalar</a>}
        {store.description && <a href="#store-about" className="inline-flex min-h-11 items-center text-muted hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]">Mağaza haqqında</a>}
        {(store.contactPhone || store.contactEmail) && <a href="#store-contact" className="inline-flex min-h-11 items-center text-muted hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]">Əlaqə</a>}
        <Link href="/stores" className="inline-flex min-h-11 items-center text-muted hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52] sm:ml-auto">Bütün mağazalar</Link>
      </nav>
    </div>
  </header>;
}
