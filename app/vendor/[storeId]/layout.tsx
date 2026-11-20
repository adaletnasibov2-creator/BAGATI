import Link from "next/link";
import { Bell } from "lucide-react";
import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { VendorNavigation } from "@/components/vendor-navigation";
import VendorLogoutButton from "@/components/vendor-logout-button";
import { requireVendorStorePage } from "@/lib/vendor-area";
import { prisma } from "@/lib/prisma";
import { getStoreEntitlements, hasFeature } from "@/lib/subscription-entitlements";
import { storeStatusLabels, subscriptionStatusLabels } from "@/lib/vendor-store-setup";
import { vendorNotificationScope } from "@/lib/vendor-notifications";
import { storeConversationsBadge } from "@/lib/messaging-pages";
import { SellerTermsCard } from "@/components/seller-terms-card";
import { hasAcceptedCurrent } from "@/lib/legal-acceptance";
import { VendorTheme } from "@/components/vendor-theme";
import { Badge } from "@/components/ui/badge";
import { focusRing } from "@/components/ui/cx";
import { subscriptionStatusTone } from "@/lib/vendor-status-tone";

export const dynamic = "force-dynamic";
const db: any = prisma;

export default async function VendorLayout({ children, params }: Readonly<{ children: React.ReactNode; params: Promise<{ storeId: string }> }>) {
  const { storeId } = await params;
  // Owner continues; a signed-in CUSTOMER goes to /vendor/apply; anyone else gets a 404.
  const access = await requireVendorStorePage(storeId);
  const [store, stores, unread, entitlement, newInquiries, conversations, sellerTermsAccepted] = await Promise.all([
    prisma.store.findUnique({ where: { id: access.storeId }, select: { name: true, status: true, isActive: true, city: { select: { name: true } }, subscription: { select: { status: true, plan: { select: { name: true } } } } } }),
    prisma.store.findMany({ where: { vendor: { userId: access.user.id } }, select: { id: true, name: true, city: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    db.notification.count({ where: vendorNotificationScope(access.user.id, access.storeId, { unreadOnly: true }) }),
    getStoreEntitlements(storeId, db),
    prisma.storeInquiry.count({ where: { storeId: access.storeId, status: "NEW" } }),
    // "Söhbətlər" badge: conversations with unread customer messages (partial index); null hides the tab while OFF.
    storeConversationsBadge(access.storeId, access.user.id),
    // The card stays above every store page until the current seller terms are accepted; nothing else is blocked.
    hasAcceptedCurrent(prisma, access.user.id, "SELLER_TERMS"),
  ]);
  if (!store) notFound();
  const subscriptionText = store.subscription ? `${store.subscription.plan.name} · ${subscriptionStatusLabels[store.subscription.status] ?? "Status məlum deyil"}` : "Abunəlik məlumatı yoxdur";
  return <VendorTheme><div className="min-h-screen bg-surface-page text-fg-body">
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex min-h-[72px] max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-7 lg:px-8">
        <div className="flex min-w-0 items-center gap-3"><span className="shrink-0 sm:hidden"><BrandLogo variant="icon"/></span><span className="hidden shrink-0 sm:inline-flex"><BrandLogo variant="compact"/></span><span aria-hidden="true" className="hidden h-8 w-px bg-line lg:block"/><div className="hidden min-w-0 lg:block"><p className="whitespace-nowrap text-[.62rem] font-semibold uppercase tracking-[.16em] text-gold-700">Satıcı paneli</p><p className="max-w-48 truncate text-sm font-semibold text-fg">{store.name}</p></div></div>
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="hidden items-center gap-2 lg:flex"><Badge tone={store.isActive ? "primary" : "gold"} className="whitespace-nowrap">{store.isActive ? "Satış aktivdir" : `Mağaza: ${storeStatusLabels[store.status] ?? "Status məlum deyil"}`}</Badge><Badge tone={store.subscription ? subscriptionStatusTone(store.subscription.status) : "neutral"} className="max-w-40 whitespace-nowrap"><span className="truncate">{subscriptionText}</span></Badge></div>
          <details className="relative min-w-0"><summary className={`max-w-[38vw] cursor-pointer list-none rounded-control border border-line px-2 py-2 text-right transition-colors hover:border-brand-200 sm:max-w-none sm:px-3 ${focusRing}`}><span className="block max-w-44 truncate text-sm font-semibold text-fg">{store.name} <span aria-hidden="true">⌄</span></span><span className="block truncate text-xs text-fg-muted">{store.city.name}</span></summary>{stores.length > 1 && <div className="absolute right-0 z-50 mt-2 max-h-80 w-64 overflow-auto rounded-card border border-line bg-white p-2 shadow-overlay">{stores.map((item: {id:string;name:string;city:{name:string}}) => <Link key={item.id} href={`/vendor/${item.id}`} className={`block rounded-control px-3 py-2.5 text-sm hover:bg-primary-subtle ${item.id === storeId ? "font-semibold text-primary" : "text-fg-secondary"}`}>{item.name}<span className="block text-xs font-normal text-fg-muted">{item.city.name}</span></Link>)}<Link href="/vendor/stores/new" className="mt-1 block border-t border-line px-3 py-3 text-sm font-medium text-primary">+ Yeni mağaza</Link></div>}</details>
          <Link href={`/vendor/${storeId}/notifications`} aria-label={`Bildirişlər${unread ? `, ${unread} oxunmamış` : ""}`} className={`relative grid h-11 w-11 shrink-0 place-items-center rounded-full text-fg transition-colors hover:bg-primary-subtle ${focusRing}`}><Bell size={18} aria-hidden="true"/>{unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>}</Link>
          <div className="hidden text-right sm:block"><p className="max-w-40 truncate text-xs font-semibold text-fg">{access.user.displayName}</p><p className="max-w-40 truncate text-[11px] text-fg-muted">{access.user.email}</p></div>
          <VendorLogoutButton/>
          <Link href="/vendor" className="hidden text-sm font-medium text-primary hover:text-primary-hover sm:inline">Mağazalar</Link>
        </div>
      </div>
    </header>
    <VendorNavigation storeId={storeId} canUseBulkImport={hasFeature(entitlement, "BULK_IMPORT")} unread={unread} newInquiries={newInquiries} conversations={conversations}/>
    <main className="mx-auto min-h-[calc(100vh-72px)] max-w-[1600px] p-4 sm:p-7 lg:ml-[248px] lg:p-9 xl:p-10">{!sellerTermsAccepted && <div className="mb-6"><SellerTermsCard/></div>}{children}</main>
  </div></VendorTheme>;
}
