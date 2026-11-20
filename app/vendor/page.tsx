import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { currentUser } from "@/lib/auth";
import { vendorAreaRedirectPath } from "@/lib/vendor-area";
import { prisma } from "@/lib/prisma";
import { getStorePublicationBlockers } from "@/lib/admin-store-product-publishing";
import { activeComplimentaryEntitlementSelect, complimentaryFromRows } from "@/lib/subscription-entitlements";
import VendorLogoutButton from "@/components/vendor-logout-button";
import { SellerTermsCard } from "@/components/seller-terms-card";
import { hasAcceptedCurrent } from "@/lib/legal-acceptance";
import { VendorTheme } from "@/components/vendor-theme";
import { VendorPageHeader } from "@/components/vendor-page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const subscriptionLabel: Record<string, string> = { PENDING: "Ödəniş gözləyir", ACTIVE: "Aktiv", PAST_DUE: "Ödəniş gecikib", SUSPENDED: "Dayandırılıb", CANCELLED: "Ləğv edilib", EXPIRED: "Bitib" };

export default async function VendorStoresPage() {
  const user = await currentUser();
  if (!user || user.role !== "VENDOR") redirect(vendorAreaRedirectPath(user?.role));
  const stores = await prisma.store.findMany({
    where: { vendor: { userId: user.id } },
    select: {
      id: true, name: true, status: true, isActive: true, legalInfoApproved: true, adminManaged: true,
      city: { select: { name: true, isActive: true } },
      vendor: { select: { sellerType: true, legalName: true, voen: true, legalAddress: true, user: { select: { isActive: true } } } },
      subscription: { select: { status: true, currentPeriodStart: true, currentPeriodEnd: true, plan: { select: { name: true, slug: true, isActive: true, monthlyPrice: true } } } },
      complimentaryEntitlements: activeComplimentaryEntitlementSelect,
      _count: { select: { products: true, storeOrders: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  // Existing and admin-created sellers accept the current seller terms here once (decision 3/4 of the audit).
  const sellerTermsAccepted = await hasAcceptedCurrent(prisma, user.id, "SELLER_TERMS");
  return <VendorTheme><div className="min-h-screen bg-surface-page text-fg-body"><header className="border-b border-line bg-white"><div className="container flex items-center justify-between py-4"><BrandLogo variant="compact"/><div className="flex items-center gap-4"><Link href="/vendor/security" className="text-sm font-medium text-primary hover:text-primary-hover">Hesabın təhlükəsizliyi</Link><VendorLogoutButton/></div></div></header><main className="container py-9 sm:py-12">{!sellerTermsAccepted && <div className="mb-7"><SellerTermsCard/></div>}<VendorPageHeader eyebrow="Satıcı portalı" title="Mağazalarınız" description="Mağazanı seçin və ya yenisini yaradın." action={<ButtonLink href="/vendor/stores/new" size="sm">+ Yeni mağaza yarat</ButtonLink>}/>
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
      complimentary: complimentaryFromRows(store.complimentaryEntitlements),
    });
    const canSell = blockers.length === 0;
    return <article key={store.id} className="rounded-card border border-line bg-white p-5 shadow-subtle"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-display text-h3 text-fg">{store.name}</h2><p className="mt-1 text-sm text-fg-muted">{store.city.name}</p></div><Badge tone={canSell?"primary":"gold"} className="shrink-0 text-right">{canSell?"Satış aktivdir":"Yayımlanma tələbləri tamamlanmayıb"}</Badge></div><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-control bg-surface-page p-3"><p className="text-xs text-fg-muted">Məhsullar</p><b className="mt-1 block text-lg">{store._count.products}</b></div><div className="rounded-control bg-surface-page p-3"><p className="text-xs text-fg-muted">Sifarişlər</p><b className="mt-1 block text-lg">{store._count.storeOrders}</b></div></div>{blockers.length>0&&<p className="mt-4 text-sm leading-6 text-gold-700">{blockers.join(" ")}</p>}<div className="mt-4 text-sm text-fg-secondary">{store.adminManaged?"Admin tərəfindən idarə olunur · abunəlik ödənişi tələb olunmur":store.subscription?`${store.subscription.plan.name} · ${subscriptionLabel[store.subscription.status]||store.subscription.status} · ${Number(store.subscription.plan.monthlyPrice).toFixed(2)} ₼/ay`:"Abunəlik planı seçilməyib"}</div><ButtonLink className="mt-5" size="sm" href={`/vendor/${store.id}`}>Paneli aç <span aria-hidden>→</span></ButtonLink></article>;
  })}</div> : <section className="mt-8 rounded-card border border-dashed border-line-strong bg-white p-7 sm:p-10"><h2 className="font-display text-h2 text-fg">Hələ mağaza yaratmamısınız</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-fg-secondary">Şəhər, əlaqə, ünvan və plan məlumatlarını əlavə edin. Mağaza qaralama kimi yaradılacaq; ödəniş və aktivləşdirmə avtomatik baş vermir.</p><ButtonLink href="/vendor/stores/new" size="sm" className="mt-5">Mağaza yaratmağa başla</ButtonLink></section>}</main></div></VendorTheme>;
}
