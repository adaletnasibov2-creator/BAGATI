import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import VendorApplyForm from "@/components/vendor-apply-form";

export const dynamic = "force-dynamic";

export default async function VendorApplyPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=%2Fvendor%2Fapply");
  if (user.role === "VENDOR") redirect("/vendor");
  if (user.role !== "CUSTOMER") redirect("/");
  const profile = await prisma.customerProfile.findUnique({ where: { userId: user.id }, select: { firstName: true, lastName: true, phone: true } });
  return <main className="container max-w-2xl py-10 sm:py-14"><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#967844]">Satıcı qeydiyyatı</p><h1 className="mt-2 text-3xl font-semibold text-[#142d38]">BAGATI-da satıcı olun</h1><p className="mt-3 text-sm leading-6 text-slate-600">Müraciət zamanı hesabınızın rolu satıcıya keçirilir. Mövcud müştəri məlumatları və sifariş tarixçəsi silinmir, lakin bu hesabın müştəri funksiyalarına girişi məhdudlaşa bilər. VÖEN bu addımda tələb olunmur; hüquqi məlumatlar mağaza təsdiqindən əvvəl toplanır.</p><VendorApplyForm displayName={[profile?.firstName, profile?.lastName].filter(Boolean).join(" ")} phone={profile?.phone || ""}/></main>;
}
