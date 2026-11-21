import { TextLink } from "@/components/ui/text-link";
import { BrandLogo } from "@/components/brand-logo";
import { GoogleLinkPanel } from "@/components/google-link-form";
import { PublicTheme } from "@/components/public-theme";

export const dynamic = "force-dynamic";

export default async function GoogleLinkPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  // MAINTENANCE-PAGE 3B: PublicTheme (fonts and public tokens, no visible chrome) and a <main> landmark, like
  // /forgot-password; before, the heading fell back to the system font and the page had no main landmark.
  return (
    <PublicTheme><main className="container grid min-h-[68vh] place-items-center py-10">
      <section className="w-full max-w-md rounded-[28px] border border-[#E6E9EC] border-t-[3px] border-t-[#C49A50] bg-white p-6 shadow-[0_24px_70px_rgba(11,23,38,.09)] sm:p-9">
        <BrandLogo variant="full" />
        <div className="mt-8">
          <p className="text-kicker uppercase text-gold-700">BAGATI</p>
          <h1 className="mt-2 font-display text-h1 text-fg">Google hesabını təsdiqləyin</h1>
          {params.status === "unavailable" ? (
            <>
              <p className="mt-3 text-sm leading-6 text-fg-secondary">Google bağlantısı bu serverdə hələ saxlanıla bilmir. E-poçt və şifrə ilə daxil olun.</p>
              <nav className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                <TextLink href="/login" className="inline-flex min-h-11 items-center">Müştəri girişi</TextLink>
                <TextLink href="/vendor/login" className="inline-flex min-h-11 items-center">Satıcı girişi</TextLink>
              </nav>
            </>
          ) : (
            // MAINTENANCE-PAGE 3B: the panel decides its state after load ("Yoxlanılır…" -> message or password form);
            // this box keeps the centred card the same height, so it does not jump (T9 measured 0.025).
            <div className="min-h-[19.5rem]"><GoogleLinkPanel /></div>
          )}
        </div>
      </section>
    </main></PublicTheme>
  );
}
