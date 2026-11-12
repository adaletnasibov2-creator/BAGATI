import Link from "next/link";
import { BadgeCheck, Mail, MapPin, MessageCircle, Store } from "lucide-react";
import StorefrontImage from "@/components/storefront-image";
import { getStorefrontTheme } from "@/lib/storefront-themes";

/**
 * Public store header. Deliberately has no email field: the store's email address must never reach
 * the browser. Buyers contact the store through WhatsApp, the phone link, or the message form.
 */
export type StorefrontBrand = {
  id: string;
  name: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  theme: string;
  cityName: string;
  /** wa.me link, only when the stored phone normalizes to an Azerbaijani mobile number. */
  whatsappUrl: string | null;
  hasAbout: boolean;
  productCount: number;
};

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C79A52]";

export default function StorefrontBranding({ store }: { store: StorefrontBrand }) {
  const colors = getStorefrontTheme(store.theme);
  const initial = store.name.trim().slice(0, 1).toLocaleUpperCase("az-AZ") || "M";

  return <header id="top" className="overflow-hidden rounded-[26px] border border-line bg-white shadow-[0_12px_36px_rgba(23,58,58,.07)]">
    {/* Fixed aspect ratio: the cover never pushes or hides the content below it. */}
    <div className="relative isolate aspect-[16/7] w-full overflow-hidden sm:aspect-[4/1] lg:aspect-auto lg:h-72" style={{ backgroundColor: colors.accentSoft }}>
      {store.bannerUrl
        ? <StorefrontImage src={store.bannerUrl} alt={`${store.name} mağazasının örtük şəkli`} className="absolute inset-0 h-full w-full object-cover" fill sizes="(max-width: 1280px) 100vw, 1280px" priority fallback={<CoverFallback accent={colors.accent} highlight={colors.highlight}/>}/>
        : <CoverFallback accent={colors.accent} highlight={colors.highlight}/>}
      {store.bannerUrl && <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#122E2E]/30 via-transparent to-transparent"/>}
    </div>

    <div className="px-4 pb-4 sm:px-8 sm:pb-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        {/* Only the logo overlaps the cover; the name block stays in normal flow, so it is never clipped. */}
        <div className="relative -mt-10 h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-4 border-white bg-[#F6F4EF] shadow-md sm:-mt-14 sm:h-28 sm:w-28">
          <StorefrontImage
            src={store.logoUrl}
            alt={`${store.name} loqosu`}
            className="h-full w-full object-contain p-2"
            fallback={<span className="grid h-full w-full place-items-center text-3xl font-semibold" style={{ color: colors.accent, backgroundColor: colors.accentSoft }}>{initial}</span>}
          />
        </div>
        <div className="min-w-0 flex-1 sm:pt-4">
          <h1 className="break-words text-2xl font-semibold leading-tight text-ink sm:text-3xl">{store.name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: colors.accent }}><BadgeCheck size={16} aria-hidden="true"/>Təsdiqlənmiş satıcı</span>
            <span aria-hidden="true" className="text-line">•</span>
            <span className="inline-flex items-center gap-1.5"><MapPin size={15} aria-hidden="true"/>{store.cityName}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:shrink-0 sm:pt-4">
          {store.whatsappUrl && <a href={store.whatsappUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-white shadow-sm sm:flex-none ${focusRing}`} style={{ backgroundColor: colors.accent }}><MessageCircle size={16} aria-hidden="true"/>WhatsApp</a>}
          <a href="#store-message" className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold sm:flex-none ${store.whatsappUrl ? "border bg-white" : "text-white shadow-sm"} ${focusRing}`} style={store.whatsappUrl ? { color: colors.accent, borderColor: colors.accent } : { backgroundColor: colors.accent }}><Mail size={16} aria-hidden="true"/>Mesaj yaz</a>
        </div>
      </div>

      <nav aria-label="Mağaza bölmələri" className="mt-4 flex gap-1 overflow-x-auto border-t border-line pt-2 text-sm font-medium sm:gap-2">
        <a href="#store-products" className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 hover:bg-[#F4F2EC] ${focusRing}`} style={{ color: colors.accent }}>Məhsullar <span className="rounded-full bg-[#F0F4F0] px-2 py-0.5 text-xs text-[#52645D]">{store.productCount}</span></a>
        {store.hasAbout && <a href="#store-about" className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-muted hover:bg-[#F4F2EC] hover:text-ink ${focusRing}`}>Haqqında</a>}
        <a href="#store-contact" className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-muted hover:bg-[#F4F2EC] hover:text-ink ${focusRing}`}>Əlaqə</a>
        <Link href="/stores" className={`ml-auto hidden min-h-11 shrink-0 items-center sm:inline-flex rounded-lg px-3 text-muted hover:bg-[#F4F2EC] hover:text-ink ${focusRing}`}>Bütün mağazalar</Link>
      </nav>
    </div>
  </header>;
}

function CoverFallback({ accent, highlight }: { accent: string; highlight: string }) {
  return <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-gradient-to-br from-[#dce8df] via-[#eef1e8] to-[#f2ead8]">
    <div className="absolute -right-10 -top-24 h-64 w-64 rounded-full border-[36px] opacity-30" style={{ borderColor: highlight }}/>
    <div className="absolute -bottom-24 left-[30%] h-48 w-48 rounded-full opacity-20" style={{ backgroundColor: accent }}/>
    <div className="absolute right-4 top-4 flex items-center gap-2 text-[11px] font-semibold tracking-[.18em] sm:right-8 sm:top-6" style={{ color: accent }}><Store size={14}/> BAGATI MAĞAZASI</div>
  </div>;
}
