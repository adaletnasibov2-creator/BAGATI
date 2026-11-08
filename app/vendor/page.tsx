import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorePublicationBlockers } from "@/lib/admin-store-product-publishing";
import VendorLogoutButton from "@/components/vendor-logout-button";

export const dynamic = "force-dynamic";

const subscriptionLabel: Record<string, string> = { PENDING: "Ödəniş gözləyir", ACTIVE: "Aktiv", PAST_DUE: "Ödəniş gecikib", SUSPENDED: "Dayandırılıb", CANCELLED: "Ləğv edilib", EXPIRED: "Bitib" };

export default async function VendorStoresPage() {
  const user = await currentUser();
  if (!user || user.role !== "VENDOR") redirect("/vendor/login");
  const stores = await prisma.store.findMany({
    where: { vendor: { userId: user.id } },
    select: {
      id: true, name: true, status: true, isActive: true, legalInfoApproved: true, adminManaged: true,
      city: { select: { name: true, isActive: true } },
      vendor: { select: { sellerType: true, legalName: true, voen: true, legalAddress: true, user: { select: { isActive: true } } } },
      subscription: { select: { status: true, currentPeriodStart: true, currentPeriodEnd: true, plan: { select: { name: true, slug: true, isActive: true, monthlyPrice: true } } } },
      _count: { select: { products: true, storeOrders: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return <div className="min-h-screen bg-[#F7F5EF] text-[#16202C]"><header className="border-b border-[#E8E7E2] bg-white"><div className="container flex items-center justify-between py-4"><BrandLogo variant="compact"/><div className="flex items-center gap-4"><Link href="/vendor/security" className="text-sm text-[#85621d]">Hesabın təhlükəsizliyi</Link><VendorLogoutButton/></div></div></header><main className="container py-9 sm:py-12"><div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-[#85621d]">Satıcı portalı</p><h1 className="mt-2 text-3xl font-semibold text-[#0B1726] sm:text-4xl">Mağazalarınız</h1><p className="mt-2 text-sm text-[#667085]">Mağazanı seçin və ya yenisini yaradın.</p></div><Link href="/vendor/stores/new" className="rounded-xl bg-[#173c40] px-5 py-3 text-sm font-semibold text-white">+ Yeni mağaza yarat</Link></div>
  {stores.length ? <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{stores.map((store) => {
    const blockers = getStorePublicationBlockers({
      status: store.status,
      isActive: store.isActive,
      legalInfoApproved: store.legalInfoApproved,
      adminManaged: store.adminManaged,
      vendorActive: store.vendor.user.isActive,
      cityActive: store.city.isActive,
      sellerType: store.vendor.sellerType,
      legalName: store.vendor.legalName,
      voen: store.vendor.voen,
      legalAddress: store.vendor.legalAddress,
      subscriptionStatus: store.subscription?.status ?? null,
      planSlug: store.subscription?.plan.slug ?? null,
      planActive: store.subscription?.plan.isActive ?? false,
      periodStart: store.subscription?.currentPeriodStart ?? null,
      periodEnd: store.subscription?.currentPeriodEnd ?? null,
    });
    const canSell = blockers.length === 0;
    return <article key={store.id} className="rounded-2xl border border-[#E8E7E2] bg-white p-5 shadow-[0_8px_24px_rgba(11,23,38,.03)]"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-[#0B1726]">{store.name}</h2><p className="mt-1 text-sm text-[#667085]">{store.city.name}</p></div><span className={`rounded-full px-2.5 py-1 text-xs ${canSell?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-800"}`}>{canSell?"Satış aktivdir":"Yayımlanma tələbləri tamamlanmayıb"}</span></div><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-[#f8f7f4] p-3"><p className="text-xs text-slate-500">Məhsullar</p><b className="mt-1 block text-lg">{store._count.products}</b></div><div className="rounded-xl bg-[#f8f7f4] p-3"><p className="text-xs text-slate-500">Sifarişlər</p><b className="mt-1 block text-lg">{store._count.storeOrders}</b></div></div>{blockers.length>0&&<p className="mt-4 text-sm leading-6 text-amber-800">{blockers.join(" ")}</p>}<div className="mt-4 text-sm text-slate-600">{store.adminManaged?"Admin tərəfindən idarə olunur · abunəlik ödənişi tələb olunmur":store.subscription?`${store.subscription.plan.name} · ${subscriptionLabel[store.subscription.status]||store.subscription.status} · ${Number(store.subscription.plan.monthlyPrice).toFixed(2)} ₼/ay`:"Abunəlik planı seçilməyib"}</div><Link className="mt-5 inline-flex rounded-lg bg-[#173c40] px-4 py-2.5 text-sm font-medium text-white" href={`/vendor/${store.id}`}>Paneli aç <span aria-hidden className="ml-2">→</span></Link></article>;
  })}</div> : <section className="mt-8 rounded-2xl border border-dashed border-[#d8d1c4] bg-white p-7 sm:p-10"><h2 className="text-xl font-semibold text-[#0B1726]">Hələ mağaza yaratmamısınız</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#667085]">Şəhər, əlaqə, ünvan və plan məlumatlarını əlavə edin. Mağaza qaralama kimi yaradılacaq; ödəniş və aktivləşdirmə avtomatik baş vermir.</p><Link href="/vendor/stores/new" className="mt-5 inline-flex rounded-xl bg-[#173c40] px-5 py-3 text-sm font-semibold text-white">Mağaza yaratmağa başla</Link></section>}</main></div>;
}
