import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { EmailVerificationForm } from "@/components/email-verification-form";
import { readEmailVerificationContext } from "@/lib/email-verification";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ next?: string; delivery?: string; from?: string }> }) {
  const [context, params] = await Promise.all([readEmailVerificationContext(), searchParams]);
  if (context?.role === "VENDOR") redirect("/vendor/verify-email");
  const nextPath = params.next?.startsWith("/") && !params.next.startsWith("//") ? params.next : "/account";
  return <div className="container grid min-h-[68vh] place-items-center py-10 sm:py-14"><section className="w-full max-w-md rounded-[28px] border border-[#E6E9EC] border-t-[3px] border-t-[#C49A50] bg-white p-6 shadow-[0_24px_70px_rgba(11,23,38,.09)] sm:p-9"><BrandLogo variant="full"/><div className="mt-8"><p className="text-kicker uppercase text-gold-700">BAGATI hesabı</p><h1 className="mt-2 font-display text-h1 text-fg">Email ünvanınızı təsdiqləyin</h1><p className="mt-3 text-sm leading-6 text-fg-secondary">Email ünvanınızı təsdiqləmək üçün 6 rəqəmli kod daxil edin. Kod yoxdursa, yenisini istəyin. Təsdiqlənmiş hesab adi girişdə yalnız e-poçt və şifrə ilə açılır.</p></div><EmailVerificationForm role="CUSTOMER" hasContext={context?.role === "CUSTOMER"} deliveryFailed={params.delivery === "failed"} fromLogin={params.from === "login"} nextPath={nextPath}/></section></div>;
}
