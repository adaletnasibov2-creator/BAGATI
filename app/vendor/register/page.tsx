import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import VendorRegisterForm from "@/components/vendor-register-form";
import { currentUser } from "@/lib/auth";

export default async function VendorRegisterPage({ searchParams }: { searchParams: Promise<{ oauth?: string; portal?: string }> }) {
  const { oauth, portal } = await searchParams;
  const user = await currentUser();
  if (user?.role === "VENDOR") redirect("/vendor");
  return <div className="container grid min-h-[70vh] place-items-center py-10"><section className="w-full max-w-xl rounded-[26px] border border-[#E8E7E2] bg-white p-6 shadow-[0_12px_34px_rgba(11,23,38,.06)] sm:p-9"><BrandLogo variant="full"/><p className="mt-8 text-xs font-semibold uppercase tracking-[.17em] text-[#85621d]">Satıcı portalı</p><h1 className="mt-2 text-3xl font-semibold text-[#0B1726]">Satıcı kimi qeydiyyat</h1><p className="mt-3 text-sm leading-6 text-[#667085]">Hesab yaradıldıqdan sonra mağazanızı və abunəlik planınızı özünüz seçə bilərsiniz. Qeydiyyat mağaza yaratmır.</p><VendorRegisterForm oauthError={oauth} portal={portal}/></section></div>;
}
