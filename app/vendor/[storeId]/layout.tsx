import Link from "next/link";
import { Bell } from "lucide-react";
import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { VendorNavigation } from "@/components/vendor-navigation";
import VendorLogoutButton from "@/components/vendor-logout-button";
import { requireStoreAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStoreEntitlements, hasFeature } from "@/lib/subscription-entitlements";
import { storeStatusLabels, subscriptionStatusLabels } from "@/lib/vendor-store-setup";
import { vendorNotificationScope } from "@/lib/vendor-notifications";

export const dynamic = "force-dynamic";
const db: any = prisma;

export default async function VendorLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ storeId: string }> }>) {
  const { storeId } = await params;
  const access = await requireStoreAccess(storeId);
  if (!access) notFound();
  const [store, stores, unread, entitlement, newInquiries] = await Promise.all([
    prisma.store.findUnique({ where: { id: access.storeId }, select: { name: true, status: true, isActive: true, city: { select: { name: true } }, subscription: { select: { status: true, plan: { select: { name: true } } } } } }),
    prisma.store.findMany({ where: { vendor: { userId: access.user.id } }, select: { id: true, name: true, city: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    db.notification.count({ where: vendorNotificationScope(access.user.id, access.storeId, { unreadOnly: true }) }),
    getStoreEntitlements(storeId, db),
    prisma.storeInquiry.count({ where: { storeId: access.storeId, status: "NEW" } }),
  ]);
  if (!store) notFound();
  return <div className="min-h-screen bg-[#f7f5ef] text-[#16202c]">
    <header className="sticky top-0 z-40 border-b border-[#e8e4da] bg-white/95 backdrop-blur">
      <div className="mx-auto flex min-h-[72px] max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-7 lg:px-8">
        <div className="flex min-w-0 items-center gap-3"><span className="sm:hidden"><BrandLogo variant="icon"/></span><span className="hidden sm:inline-flex"><BrandLogo variant="compact"/></span><span className="hidden h-8 w-px bg-[#e8e4da] sm:block"/><div className="hidden min-w-0 sm:block"><p className="text-[.62rem] font-semibold uppercase tracking-[.18em] text-[#967844]">Satıcı paneli</p><p className="max-w-48 truncate text-sm font-semibold text-[#142d38]">{store.name}</p></div></div>
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 md:flex"><span className={`rounded-full px-2.5 py-1 text-[.68rem] font-semibold ${store.isActive ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{store.isActive ? "Sat\u0131\u015F aktivdir" : `Ma\u011Faza: ${storeStatusLabels[store.status] ?? "Status m\u0259lum deyil"}`}</span><span className="max-w-40 truncate rounded-full bg-[#f7f5ef] px-2.5 py-1 text-[.68rem] text-[#536273]">{store.subscription ? `${store.subscription.plan.name} · ${subscriptionStatusLabels[store.subscription.status] ?? "Status məlum deyil"}` : "Abun\u0259lik m\u0259lumat\u0131 yoxdur"}</span></div>
          <details className="relative min-w-0"><summary className="max-w-[38vw] cursor-pointer list-none rounded-xl border border-[#e8e4da] px-2 py-2 text-right sm:max-w-none sm:px-3"><span className="block max-w-44 truncate text-sm font-semibold text-[#142d38]">{store.name} <span aria-hidden="true">⌄</span></span><span className="block truncate text-xs text-[#667085]">{store.city.name}</span></summary>{stores.length > 1 && <div className="absolute right-0 z-50 mt-2 max-h-80 w-64 overflow-auto rounded-2xl border border-[#e8e4da] bg-white p-2 shadow-[0_18px_45px_rgba(11,23,38,.14)]">{stores.map((item: {id:string;name:string;city:{name:string}}) => <Link key={item.id} href={`/vendor/${item.id}`} className={`block rounded-xl px-3 py-2.5 text-sm hover:bg-[#f7f5ef] ${item.id === storeId ? "font-semibold text-[#173c40]" : "text-slate-600"}`}>{item.name}<span className="block text-xs font-normal text-slate-500">{item.city.name}</span></Link>)}<Link href="/vendor/stores/new" className="mt-1 block border-t px-3 py-3 text-sm font-medium text-[#85621d]">+ Yeni mağaza</Link></div>}</details>
          <Link href={`/vendor/${storeId}/notifications`} aria-label={`Bildiri\u015Fl\u0259r${unread ? `, ${unread} oxunmam\u0131\u015F` : ""}`} className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[#142d38] transition hover:bg-[#f7f5ef]"><Bell size={18}/>{unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#173c40] px-1 text-[9px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>}</Link>
          <div className="hidden text-right sm:block"><p className="max-w-40 truncate text-xs font-semibold text-[#142d38]">{access.user.displayName}</p><p className="max-w-40 truncate text-[11px] text-[#667085]">{access.user.email}</p></div>
          <VendorLogoutButton/>
          <Link href="/vendor" className="hidden text-sm font-medium text-[#85621d] sm:inline">Mağazalar</Link>
        </div>
      </div>
    </header>
    <VendorNavigation storeId={storeId} canUseBulkImport={hasFeature(entitlement, "BULK_IMPORT")} unread={unread} newInquiries={newInquiries}/>
    <main className="mx-auto min-h-[calc(100vh-72px)] max-w-[1600px] p-4 sm:p-7 lg:ml-[248px] lg:p-9 xl:p-10">{children}</main>
  </div>;
}
