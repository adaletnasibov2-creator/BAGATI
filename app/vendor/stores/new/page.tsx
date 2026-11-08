import { redirect } from "next/navigation";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import VendorStoreCreateForm from "@/components/vendor-store-create-form";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const db: any = prisma;

export default async function NewVendorStorePage() {
  const user = await currentUser();
  if (!user || user.role !== "VENDOR") redirect("/vendor/login");
  const [cities, plans] = await Promise.all([
    prisma.city.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.subscriptionPlan.findMany({ where: { isActive: true }, select: { id: true, name: true, description: true, monthlyPrice: true }, orderBy: { monthlyPrice: "asc" } }),
  ]);
  return <div className="min-h-screen bg-[#F7F5EF] text-[#16202C]"><header className="border-b border-[#E8E7E2] bg-white"><div className="container flex items-center justify-between py-4"><BrandLogo variant="compact"/><Link href="/vendor" className="text-sm text-[#85621d]">← Satıcı paneli</Link></div></header><main className="container max-w-4xl py-8 sm:py-12"><p className="text-xs font-semibold uppercase tracking-[.18em] text-[#85621d]">Yeni mağaza</p><h1 className="mt-2 text-3xl font-semibold text-[#0B1726] sm:text-4xl">Mağazanızı BAGATI-da yaradın</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[#667085]">Mağaza qaralama və qeyri-aktiv yaradılacaq. Abunəlik gözləyir statusunda qalacaq; platformada ödəniş inteqrasiyası yoxdur və mağaza satışa avtomatik açılmayacaq.</p><VendorStoreCreateForm cities={cities} plans={plans.map((p:any)=>({...p,monthlyPrice:p.monthlyPrice.toString()}))}/></main></div>;
}
