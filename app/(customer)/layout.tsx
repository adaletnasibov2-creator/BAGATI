import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { Header } from "@/components/header";
import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

export default async function CustomerLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const settings = await getSiteSettings();

  return (
    <>
      <Header branding={{ siteName: settings.siteName, logoUrl: settings.logoUrl }} />
      <main className="min-h-[55vh]">{children}</main>
      <footer className="mt-14 bg-[#122E2E] text-[#E7EEEA]">
        <div className="container grid gap-x-8 gap-y-9 py-9 sm:grid-cols-2 sm:py-11 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr]">
          <div>
            <BrandLogo variant="full" light siteName={settings.siteName} logoUrl={settings.logoUrl} />
            <p className="mt-3 max-w-xs text-sm leading-6 text-[#C5D4CE]">
              Azərbaycan mağazalarını və məhsullarını bir məkanda kəşf edin.
            </p>
            {settings.contactPhone || settings.contactEmail ? (
              <div className="mt-4">
                {settings.contactPhone && (
                  <a className="block min-h-11 text-sm leading-11 text-[#E7EEEA] hover:text-[#E8D7B7]" href={`tel:${settings.contactPhone}`}>
                    {settings.contactPhone}
                  </a>
                )}
                {settings.contactEmail && (
                  <a className="block min-h-11 text-sm leading-11 text-[#E7EEEA] hover:text-[#E8D7B7]" href={`mailto:${settings.contactEmail}`}>
                    {settings.contactEmail}
                  </a>
                )}
              </div>
            ) : (
              <p className="mt-4 max-w-xs text-sm leading-6 text-[#C5D4CE]">
                Biznes əlaqə məlumatları sayt parametrlərindən əlavə olunacaq.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {settings.instagramUrl && <a className="min-h-11 inline-flex items-center text-[#C5D4CE] hover:text-[#E8D7B7]" href={settings.instagramUrl} target="_blank" rel="noreferrer">Instagram</a>}
              {settings.facebookUrl && <a className="min-h-11 inline-flex items-center text-[#C5D4CE] hover:text-[#E8D7B7]" href={settings.facebookUrl} target="_blank" rel="noreferrer">Facebook</a>}
              {settings.tiktokUrl && <a className="min-h-11 inline-flex items-center text-[#C5D4CE] hover:text-[#E8D7B7]" href={settings.tiktokUrl} target="_blank" rel="noreferrer">TikTok</a>}
            </div>
          </div>
          <FooterColumn title="Müştərilər üçün" links={[
            ["/categories", "Kateqoriyalar"],
            ["/products", "Məhsullar"],
            ["/orders", "Sifarişlərim"],
            ["/favorites", "Sevimlilər"],
          ]} />
          <FooterColumn title="Mağazalar üçün" links={[
            ["/stores", "Mağazaları kəşf et"],
            ["/vendor", "Satıcı kabineti"],
            ["/vendor/apply", "Mağaza müraciəti"],
          ]} />
          <FooterColumn title="Dəstək" links={[
            ["/help", "Kömək mərkəzi"],
            ["/contact", "Əlaqə"],
            ["/delivery-returns", "Çatdırılma və qaytarılma"],
            ["/support", "Dəstəyə yaz"],
            ["/about", "Haqqımızda"],
          ]} />
          <FooterColumn title="Hüquqi məlumat" links={[
            ["/privacy", "Gizlilik siyasəti"],
            ["/terms", "İstifadə şərtləri"],
          ]} />
        </div>
        <div className="border-t border-white/10">
          <div className="container flex flex-col gap-2 py-4 text-xs text-[#C5D4CE] sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} {settings.siteName}</span>
            <Link href="/support" className="inline-flex min-h-11 items-center hover:text-white">Dəstək ilə əlaqə</Link>
          </div>
        </div>
      </footer>
    </>
  );
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <div className="mt-2 grid">
        {links.map(([href, label]) => (
          <Link key={href + label} href={href} className="inline-flex min-h-11 items-center text-sm text-[#C5D4CE] transition hover:text-[#E8D7B7]">
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
