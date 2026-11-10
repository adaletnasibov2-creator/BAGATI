import Link from "next/link";
import { Mail, MessageCircle, Phone } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import type { getSiteSettings } from "@/lib/site-settings";
import { toTelephoneHref, toWhatsAppHref } from "@/lib/public-contact-links";

type FooterSettings = Pick<
  Awaited<ReturnType<typeof getSiteSettings>>,
  "siteName" | "logoUrl" | "contactPhone" | "contactEmail" | "instagramUrl" | "facebookUrl" | "tiktokUrl"
>;

export function CustomerFooter({ settings }: { settings: FooterSettings }) {
  const whatsappHref = toWhatsAppHref(settings.contactPhone);
  const telephoneHref = toTelephoneHref(settings.contactPhone);

  return (
    <footer className="mt-14 border-t border-white/10 bg-bagati-deep pb-[calc(72px+env(safe-area-inset-bottom))] text-[#E7EEEA] md:pb-0">
      <div className="container grid gap-x-10 gap-y-9 py-10 sm:grid-cols-2 sm:py-12 lg:grid-cols-[1.35fr_1fr_1fr_1.2fr]">
        <section aria-labelledby="footer-brand-title">
          <h2 id="footer-brand-title" className="sr-only">{settings.siteName}</h2>
          <BrandLogo variant="full" light siteName={settings.siteName} logoUrl={settings.logoUrl} />
          <p className="mt-4 max-w-xs text-sm leading-6 text-[#E6D8BD]">
            Azərbaycan mağazalarını və məhsullarını bir məkanda kəşf et.
          </p>
          {(whatsappHref || telephoneHref || settings.contactEmail) ? (
            <div className="mt-5 grid gap-2">
              {whatsappHref && settings.contactPhone && (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`WhatsApp-da yaz: ${settings.contactPhone}`}
                  className="inline-flex min-h-11 w-fit max-w-full items-center gap-2.5 rounded-xl border border-white/15 bg-white/[.06] px-3.5 text-sm font-medium text-[#E7EEEA] transition-colors hover:border-[#9BC4AE]/50 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold"
                >
                  <MessageCircle aria-hidden="true" size={17} className="shrink-0 text-[#9BC4AE]" />
                  <span className="truncate">WhatsApp · {settings.contactPhone}</span>
                </a>
              )}
              {!whatsappHref && telephoneHref && settings.contactPhone && (
                <a
                  href={telephoneHref}
                  aria-label={`Zəng et: ${settings.contactPhone}`}
                  className="inline-flex min-h-11 w-fit max-w-full items-center gap-2.5 rounded-xl border border-white/15 bg-white/[.06] px-3.5 text-sm font-medium text-[#E7EEEA] transition-colors hover:border-[#9BC4AE]/50 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold"
                >
                  <Phone aria-hidden="true" size={17} className="shrink-0 text-[#9BC4AE]" />
                  <span className="truncate">Zəng et · {settings.contactPhone}</span>
                </a>
              )}
              {settings.contactEmail && (
                <a
                  href={`mailto:${settings.contactEmail}`}
                  aria-label={`E-poçt yaz: ${settings.contactEmail}`}
                  className="inline-flex min-h-11 w-fit max-w-full items-center gap-2.5 rounded-xl border border-white/15 bg-white/[.06] px-3.5 text-sm font-medium text-[#E7EEEA] transition-colors hover:border-[#D9C69E]/50 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold"
                >
                  <Mail aria-hidden="true" size={17} className="shrink-0 text-[#D9C69E]" />
                  <span className="truncate">{settings.contactEmail}</span>
                </a>
              )}
            </div>
          ) : (
            <p className="mt-4 max-w-xs text-sm leading-6 text-white/70">
              Əlaqə məlumatları mövcud olduqda burada göstəriləcək.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {settings.instagramUrl && <a className="inline-flex min-h-11 items-center text-white/75 transition-colors hover:text-bagati-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold" href={settings.instagramUrl} target="_blank" rel="noreferrer">Instagram</a>}
            {settings.facebookUrl && <a className="inline-flex min-h-11 items-center text-white/75 transition-colors hover:text-bagati-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold" href={settings.facebookUrl} target="_blank" rel="noreferrer">Facebook</a>}
            {settings.tiktokUrl && <a className="inline-flex min-h-11 items-center text-white/75 transition-colors hover:text-bagati-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold" href={settings.tiktokUrl} target="_blank" rel="noreferrer">TikTok</a>}
          </div>
        </section>
        <FooterColumn title="Alış-veriş" links={[
          ["/categories", "Kateqoriyalar"],
          ["/products", "Bütün məhsullar"],
          ["/deals", "Endirimlər və kampaniyalar"],
          ["/new-products", "Yeni məhsullar"],
          ["/favorites", "Sevimlilər"],
        ]} />
        <FooterColumn title="Mağazalar və satıcılar" links={[
          ["/stores", "Mağazaları kəşf et"],
          ["/vendor", "Satıcı kabineti"],
          ["/vendor/apply", "Satıcı ol"],
        ]} />
        <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-1">
          <FooterColumn title="Yardım və dəstək" links={[
            ["/help", "Kömək mərkəzi"],
            ["/delivery-returns", "Çatdırılma və qaytarılma"],
            ["/support", "Dəstəyə yaz"],
            ["/about", "Haqqımızda"],
          ]} />
          <FooterColumn title="Hüquqi məlumat" links={[
            ["/privacy", "Gizlilik siyasəti"],
            ["/terms", "İstifadə şərtləri"],
          ]} />
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container flex flex-col gap-2 py-4 text-xs text-white/70 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} {settings.siteName}</span>
          <div className="flex flex-wrap gap-x-5">
            <Link href="/privacy" className="inline-flex min-h-11 items-center hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold">Gizlilik</Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold">İstifadə şərtləri</Link>
            <Link href="/support" className="inline-flex min-h-11 items-center hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold">Dəstək</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <div className="mt-2 grid">
        {links.map(([href, label]) => (
          <Link key={href + label} href={href} className="inline-flex min-h-11 items-center text-sm text-white/70 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bagati-gold">
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
