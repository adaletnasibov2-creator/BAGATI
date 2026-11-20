import { redirect } from "next/navigation";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import VendorStoreCreateForm from "@/components/vendor-store-create-form";
import { SellerTermsCard } from "@/components/seller-terms-card";
import { hasAcceptedCurrent } from "@/lib/legal-acceptance";
import { VendorTheme } from "@/components/vendor-theme";
import { VendorPageHeader } from "@/components/vendor-page-header";
import { currentUser } from "@/lib/auth";
import { vendorAreaRedirectPath } from "@/lib/vendor-area";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function NewVendorStorePage() {
  const user = await currentUser();
  if (!user || user.role !== "VENDOR") redirect(vendorAreaRedirectPath(user?.role));
  const [cities, sellerTermsAccepted] = await Promise.all([
    prisma.city.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    hasAcceptedCurrent(prisma, user.id, "SELLER_TERMS"),
  ]);
  return <VendorTheme><div className="min-h-screen bg-surface-page text-fg-body"><header className="border-b border-line bg-white"><div className="container flex items-center justify-between py-4"><BrandLogo variant="compact"/><Link href="/vendor" className="text-sm font-medium text-primary hover:text-primary-hover">← Satıcı paneli</Link></div></header><main className="container max-w-4xl py-8 sm:py-12"><VendorPageHeader eyebrow="Yeni mağaza" title="Mağazanızı BAGATI-da yaradın" description="Əvvəl mağazanın adını və şəhərini seçin. Qaralama yaradıldıqdan sonra əlaqə, görünüş və hüquqi məlumatları mərhələli şəkildə əlavə edə bilərsiniz. Mağaza yoxlama və aktivləşdirmə olmadan satışa açılmayacaq."/>{!sellerTermsAccepted && <div className="mt-6"><SellerTermsCard/></div>}<VendorStoreCreateForm cities={cities}/></main></div></VendorTheme>;
}
