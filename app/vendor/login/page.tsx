import { redirect } from "next/navigation";
import { ActiveSessionNotice } from "@/components/active-session-notice";
import { BrandLogo } from "@/components/brand-logo";
import { VendorLoginForm } from "@/components/vendor-login-form";

export const dynamic = "force-dynamic";

export default async function VendorLoginPage({ searchParams }: { searchParams: Promise<{ oauth?: string; verified?: string; portal?: string }> }) {
  const { oauth, verified, portal } = await searchParams;
  if (oauth === "link-pending") redirect("/auth/google/link");
  const notice = verified === "1" ? "Email ünvanınız təsdiqləndi. İndi satıcı hesabınıza daxil ola bilərsiniz." : undefined;
  return (
    // DESIGN-T8: the same card as the customer /login (texts unchanged). The public fonts stay off under app/vendor.
    <div className="container grid min-h-[68vh] place-items-center py-10 sm:py-14">
      <section className="w-full max-w-md rounded-[28px] border border-[#E6E9EC] border-t-[3px] border-t-[#C49A50] bg-white p-6 shadow-[0_24px_70px_rgba(11,23,38,.09)] sm:p-9">
        <BrandLogo variant="full" />

        <div className="mt-8">
          <p className="text-xs font-semibold uppercase tracking-[.17em] text-[#85621d]">
            Satıcı hesabı
          </p>

          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#0B1726]">
            Satıcı panelinə giriş
          </h1>

          <p className="mt-3 text-sm leading-6 text-[#667085]">
            Mağazanızı və məhsullarınızı idarə etmək üçün daxil olun.
          </p>
          <p className="mt-2 text-sm leading-6 text-[#667085]">
            Müştəri hesabı satıcı hesabından ayrıdır. Satıcı müraciəti üçün müştəri hesabınızla daxil olun və “Satıcı olmaq istəyirəm” keçidinə basın.
          </p>
        </div>

        <ActiveSessionNotice returnTo="/vendor/login" />
        <VendorLoginForm oauthError={oauth} notice={notice} portal={portal}/>
      </section>
    </div>
  );
}
