import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { GoogleLinkPanel } from "@/components/google-link-form";

export const dynamic = "force-dynamic";

export default async function GoogleLinkPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  return (
    <div className="container grid min-h-[68vh] place-items-center py-10">
      <section className="w-full max-w-md rounded-[28px] border border-[#E6E9EC] border-t-[3px] border-t-[#C49A50] bg-white p-6 shadow-[0_24px_70px_rgba(11,23,38,.09)] sm:p-9">
        <BrandLogo variant="full" />
        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-[.17em] text-[#85621d]">BAGATI</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#0B1726]">Google hesabını təsdiqləyin</h1>
          {params.status === "unavailable" ? (
            <>
              <p className="mt-3 text-sm leading-6 text-[#667085]">Google bağlantısı bu serverdə hələ saxlanıla bilmir. E-poçt və şifrə ilə daxil olun.</p>
              <nav className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-[#85621d] underline">
                <Link href="/login">Müştəri girişi</Link>
                <Link href="/vendor/login">Satıcı girişi</Link>
              </nav>
            </>
          ) : <GoogleLinkPanel />}
        </div>
      </section>
    </div>
  );
}
