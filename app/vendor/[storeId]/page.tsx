import Image from "next/image";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowUpRight, BadgeCheck, Boxes, ClipboardList, Package, PackageCheck, Plus, RotateCcw, ShoppingBag, Store, TrendingUp } from "lucide-react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireVendorStorePage } from "@/lib/vendor-area";
import { statusLabel } from "@/lib/order-status";
import { getStorePublicationBlockers } from "@/lib/admin-store-product-publishing";
import { activeComplimentaryEntitlementSelect, complimentaryFromRows } from "@/lib/subscription-entitlements";
import { getStorefrontBrandingCompatibility } from "@/lib/storefront-branding-compat";
import { missingSellerLegalFields, sellerRequirementLabels } from "@/lib/seller-legal-policy";
import { buildVendorStoreSetup, subscriptionStatusLabels } from "@/lib/vendor-store-setup";
import { vendorNotificationHref, vendorNotificationScope } from "@/lib/vendor-notifications";
import { Bell, CheckCircle2, Circle } from "lucide-react";
import { VendorPageHeader } from "@/components/vendor-page-header";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { cardClass } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cx, focusRing } from "@/components/ui/cx";
import { approvalTone, orderStatusTone, productStatusTone } from "@/lib/vendor-status-tone";

export const dynamic = "force-dynamic";
const db: any = prisma;
type Props = { params: Promise<{ storeId: string }> };

export default async function VendorOverview({ params }: Props) {
  const { storeId } = await params;
  const access = await requireVendorStorePage(storeId);
  if (!access) notFound();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [store, today, pending, returnRequests, completed, productTotal, activeProducts, recentOrders, products, stockRows, salesToday, newOrders, branding, recentNotifications] = await Promise.all([
    db.store.findUnique({ where: { id: storeId }, select: {
      name: true, slug: true, description: true, logoUrl: true, contactPhone: true, contactEmail: true, address: true, reviewNote: true,
      status: true, isActive: true, adminManaged: true, legalInfoApproved: true,
      city: { select: { name: true, isActive: true } },
      vendor: { select: { sellerType: true, legalName: true, voen: true, legalAddress: true, user: { select: { isActive: true } } } },
      subscription: { select: {
        status: true, currentPeriodStart: true, currentPeriodEnd: true,
        plan: { select: { slug: true, isActive: true, name: true } },
      } },
      complimentaryEntitlements: activeComplimentaryEntitlementSelect,
    } }),
    db.storeOrder.count({ where: { storeId, createdAt: { gte: todayStart } } }),
    db.storeOrder.count({ where: { storeId, status: { in: ["NEW", "CONFIRMED", "PREPARING", "READY", "HANDED_TO_COURIER"] } } }),
    db.returnRequest.count({ where: { storeId, status: "REQUESTED" } }),
    db.storeOrder.count({ where: { storeId, status: "DELIVERED" } }),
    db.product.count({ where: { storeId } }),
    db.product.count({ where: { storeId, status: "ACTIVE" } }),
    db.storeOrder.findMany({ where: { storeId }, take: 5, orderBy: { createdAt: "desc" }, select: { id: true, status: true, subtotal: true, createdAt: true, order: { select: { id: true } } } }),
    db.product.findMany({ where: { storeId }, take: 6, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, price: true, status: true, images: true, updatedAt: true } }),
    db.inventory.findMany({ where: { product: { storeId } }, include: { product: { select: { id: true, name: true, sku: true } } }, orderBy: { quantity: "asc" } }),
    db.storeOrder.aggregate({ where: { storeId, status: "DELIVERED", OR: [{ deliveredAt: { gte: todayStart } }, { deliveredAt: null, createdAt: { gte: todayStart } }] }, _sum: { subtotal: true } }),
    db.storeOrder.count({ where: { storeId, status: { in: ["NEW", "PENDING"] } } }),
    getStorefrontBrandingCompatibility(storeId),
    db.notification.findMany({ where: vendorNotificationScope(access.user.id, access.storeId), select: { id: true, title: true, body: true, readAt: true, createdAt: true, storeId: true }, orderBy: { createdAt: "desc" }, take: 4 }),
  ]);
  if (!store) notFound();
  const readinessBlockers = getStorePublicationBlockers({
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
  const setup = buildVendorStoreSetup({
    name: store.name, slug: store.slug, description: store.description, cityName: store.city.name,
    contactPhone: store.contactPhone, contactEmail: store.contactEmail, address: store.address,
    logoUrl: store.logoUrl, bannerUrl: branding?.bannerUrl ?? null, bannerSupported: Boolean(branding?.available),
    missingLegalFields: missingSellerLegalFields(store.vendor).map((field) => sellerRequirementLabels[field]),
    legalInfoApproved: store.legalInfoApproved, adminManaged: store.adminManaged,
    storeStatus: store.status, storeActive: store.isActive, reviewNote: store.reviewNote,
    subscriptionStatus: store.subscription?.status ?? null,
    productCount: productTotal, activeProductCount: activeProducts,
  });
  const productStatusLabels: Record<string, string> = { DRAFT: "Qaralama", ACTIVE: "Aktiv", ARCHIVED: "Arxivdə" };
  const outOfStock = stockRows.filter((item: any) => item.quantity - item.reserved <= 0).length;
  const lowStock = stockRows.filter((item: any) => item.quantity - item.reserved > 0 && item.quantity - item.reserved <= item.lowStockThreshold).length;
  const warnings = stockRows.filter((item: any) => Math.max(0, item.quantity - item.reserved) <= item.lowStockThreshold).slice(0, 6);
  const salesAmount = Number(salesToday._sum.subtotal || 0);
  // Three groups instead of ten equal cards. `attention` is set only while the number is above 0.
  const groups: { id: string; title: string; cards: StatCardData[] }[] = [
    { id: "orders", title: "Sifarişlər", cards: [
      { label: "Yeni sifarişlər (cavab gözləyir)", value: newOrders, href: "orders", Icon: ClipboardList, attention: newOrders > 0 ? "warning" : null },
      { label: "Bu gün sifarişlər", value: today, href: "orders", Icon: ClipboardList },
      { label: "Gözləyən sifarişlər", value: pending, href: "orders", Icon: Activity },
      { label: "Yeni qaytarılma sorğuları", value: returnRequests, href: "returns", Icon: RotateCcw, attention: returnRequests > 0 ? "warning" : null },
    ] },
    { id: "products", title: "Məhsullar", cards: [
      { label: "Məhsullar", value: productTotal, href: "products", Icon: Package },
      { label: "Aktiv məhsullar", value: activeProducts, href: "products", Icon: BadgeCheck },
      { label: "Az stok", value: lowStock, href: "inventory", Icon: AlertTriangle, attention: lowStock > 0 ? "warning" : null },
      { label: "Stokda yoxdur", value: outOfStock, href: "inventory", Icon: ShoppingBag, attention: outOfStock > 0 ? "danger" : null },
    ] },
    { id: "sales", title: "Satış", cards: [
      { label: "Bu gün təhvil verilmiş satış", value: `${salesAmount.toFixed(2)} AZN`, href: "sales", Icon: TrendingUp },
      { label: "Tamamlanmış sifarişlər", value: completed, href: "orders", Icon: PackageCheck },
    ] },
  ];
  const quickActions = [
    { label: "Məhsul əlavə et", href: "products/new", Icon: Plus },
    { label: "Sifarişlər", href: "orders", Icon: ClipboardList },
    { label: "Anbar qalığı", href: "inventory", Icon: Boxes },
    { label: "Mağazam", href: "profile", Icon: Store },
  ];
  const panel = cx(cardClass({ padding: "none" }), "overflow-hidden");
  const rowLink = `transition-colors hover:bg-primary-subtle ${focusRing} focus-visible:outline-offset-[-2px]`;
  const panelHead = (eyebrow: string, title: string, link: { href: string; label: string }) => <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
    <div className="min-w-0"><p className="text-kicker uppercase text-gold-700">{eyebrow}</p><h2 className="mt-1 font-display text-h3 text-fg">{title}</h2></div>
    <Link className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium text-primary hover:bg-primary-subtle ${focusRing}`} href={link.href}>{link.label} <ArrowUpRight size={15} aria-hidden="true"/></Link>
  </div>;

  return <div className="space-y-7">
    <VendorPageHeader
      eyebrow="BAGATI satıcı paneli"
      title={<>Salam, {store.name}</>}
      description={<>{store.city.name} <span aria-hidden="true">·</span> {store.isActive ? "İctimai görünürlük aktivdir" : "İctimai görünürlük deaktivdir"}</>}
      action={<><ButtonLink href={`/vendor/${storeId}/orders`} variant="secondary" size="sm"><ClipboardList size={16} aria-hidden="true"/> Sifarişlər</ButtonLink><ButtonLink href={`/vendor/${storeId}/products/new`} size="sm"><Plus size={17} aria-hidden="true"/> Məhsul əlavə et</ButtonLink></>}
    />
    <div className={readinessBlockers.length ? "rounded-card border border-gold-200 bg-[#faf5ec] p-4 sm:px-5" : "rounded-card border border-brand-100 bg-primary-subtle p-4 sm:px-5"}>
      <p className={`flex items-center gap-2 text-sm font-semibold ${readinessBlockers.length ? "text-gold-700" : "text-primary"}`}>{readinessBlockers.length ? <AlertTriangle size={16} aria-hidden="true"/> : <CheckCircle2 size={16} aria-hidden="true"/>}{readinessBlockers.length ? "İctimai satışa hazır deyil" : "İctimai satışa hazırdır"}</p>
      {readinessBlockers.length > 0 && <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-fg-body">{readinessBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
    </div>

    <section aria-labelledby="quick-actions-heading">
      <h2 id="quick-actions-heading" className="text-kicker uppercase text-gold-700">Tez əməliyyatlar</h2>
      <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">{quickActions.map(({ label, href, Icon }) => <li key={href}><Link href={`/vendor/${storeId}/${href}`} className={`group flex min-h-16 items-center gap-3 rounded-card border border-line bg-white p-3 text-sm font-semibold text-fg transition-[border-color,box-shadow] duration-150 hover:border-brand-200 hover:shadow-subtle motion-reduce:transition-none sm:p-4 ${focusRing}`}><span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-subtle text-primary ring-1 ring-inset ring-brand-100 transition-colors group-hover:bg-primary group-hover:text-white"><Icon size={18}/></span><span className="min-w-0">{label}</span></Link></li>)}</ul>
    </section>

    <section aria-labelledby="setup-heading" className={cardClass({ padding: "md" })}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-kicker uppercase text-gold-700">Mağaza qurulumu</p><h2 id="setup-heading" className="mt-1 font-display text-h3 text-fg">{setup.completed === setup.total ? "Mağazanız tam hazırdır" : `${setup.completed} / ${setup.total} addım tamamlanıb`}</h2></div>
        <div className="flex flex-wrap items-center gap-2"><Badge tone={approvalTone(setup.approval.tone)}>Status: {setup.approval.label}</Badge><Badge tone="neutral">Abunəlik: {store.subscription ? `${store.subscription.plan.name} · ${subscriptionStatusLabels[store.subscription.status] ?? "Status məlum deyil"}` : "seçilməyib"}</Badge></div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-label="Mağaza qurulumu" aria-valuemin={0} aria-valuemax={100} aria-valuenow={setup.percent}><div className="h-full rounded-full bg-primary transition-all motion-reduce:transition-none" style={{ width: `${setup.percent}%` }}/></div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{setup.steps.map((step, index) => <li key={step.key} className={`flex gap-3 rounded-control border p-3 ${step.done ? "border-brand-100 bg-primary-subtle" : step.key === setup.nextStep?.key ? "border-gold-400 bg-[#faf5ec]" : "border-line"}`}>
        {step.done ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true"/> : <Circle size={18} className="mt-0.5 shrink-0 text-line-strong" aria-hidden="true"/>}
        <div className="min-w-0"><p className="text-sm font-medium text-fg">{index + 1}. {step.label}<span className="sr-only">{step.done ? " — tamamlanıb" : " — tamamlanmayıb"}</span></p><p className="mt-0.5 break-words text-xs text-fg-muted">{step.detail}</p>{!step.done && <Link href={`/vendor/${storeId}/${step.href}`} className={`mt-1.5 inline-flex min-h-8 items-center rounded-sm text-xs font-semibold text-primary hover:underline ${focusRing}`}>{step.actionLabel} →</Link>}</div>
      </li>)}</ol>
    </section>

    <div className="grid gap-x-5 gap-y-7 xl:grid-cols-2">{groups.map((group) => <section key={group.id} aria-labelledby={`stats-${group.id}`} className={group.cards.length < 4 ? "xl:col-span-2" : undefined}>
      <h2 id={`stats-${group.id}`} className="font-display text-h3 text-fg">{group.title}</h2>
      <div className={`mt-3 grid gap-3 sm:grid-cols-2 ${group.cards.length < 4 ? "xl:grid-cols-4" : ""}`}>{group.cards.map((card) => <StatCard key={card.label} card={card} storeId={storeId}/>)}</div>
    </section>)}</div>

    <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <section className={panel}>{panelHead("Son fəaliyyət", "Son sifarişlər", { href: `/vendor/${storeId}/orders`, label: "Hamısını" })}<div className="divide-y divide-line">{recentOrders.length ? recentOrders.map((order:any)=><Link key={order.id} href={`/vendor/${storeId}/orders/${order.id}`} className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${rowLink}`}><span><span className="block text-sm font-semibold text-fg">#{order.order.id.slice(-8).toUpperCase()}</span><span className="mt-1 block text-xs text-fg-muted">{new Date(order.createdAt).toLocaleString("az-AZ")}</span></span><span className="flex items-center gap-3"><Badge tone={orderStatusTone(order.status)}>{statusLabel(order.status)}</Badge><b className="text-sm text-fg">{Number(order.subtotal).toFixed(2)} AZN</b></span></Link>) : <div className="p-7 text-center"><ClipboardList className="mx-auto text-line-strong" size={25} aria-hidden="true"/><p className="mt-2 text-sm font-medium text-fg">Hələ sifariş yoxdur</p><p className="mt-1 text-xs text-fg-muted">Yeni sifarişlər bu bölmədə görünəcək.</p></div>}</div></section>
      <section className={panel}>{panelHead("Stok nəzarəti", "Anbar xəbərdarlıqları", { href: `/vendor/${storeId}/inventory`, label: "Anbar qalığı" })}<div className="divide-y divide-line">{warnings.length ? warnings.map((item:any)=><Link key={item.id} href={`/vendor/${storeId}/inventory`} className={`flex items-center justify-between gap-3 px-5 py-3.5 ${rowLink}`}><span className="min-w-0"><span className="block truncate text-sm font-medium text-fg">{item.product.name}</span><span className="mt-1 block truncate text-xs text-fg-muted">Məhsul kodu: {item.product.sku||"—"}</span></span><Badge tone={item.quantity-item.reserved<=0?"danger":"gold"} className="shrink-0">{Math.max(0,item.quantity-item.reserved)} ədəd</Badge></Link>) : <div className="p-7 text-center"><BadgeCheck className="mx-auto text-primary" size={25} aria-hidden="true"/><p className="mt-2 text-sm font-medium text-fg">Aşağı ehtiyatlı məhsul yoxdur</p><p className="mt-1 text-xs text-fg-muted">Stok yeniləndikcə xəbərdarlıqlar burada görünəcək.</p></div>}</div></section>
    </div>
    <section className={panel}>{panelHead("Xəbərlər", "Son bildirişlər", { href: `/vendor/${storeId}/notifications`, label: "Hamısı" })}{recentNotifications.length ? <ul className="divide-y divide-line">{recentNotifications.map((item: any) => { const href = vendorNotificationHref(storeId, item.title, item.storeId === storeId); const body = <><span className="flex items-center gap-2 text-sm font-medium text-fg">{!item.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-gold-400" aria-label="Oxunmayıb"/>}{item.title}</span><span className="mt-0.5 block truncate text-xs text-fg-muted">{item.body}</span><span className="mt-0.5 block text-[11px] text-fg-muted">{new Date(item.createdAt).toLocaleString("az-AZ")}</span></>; return <li key={item.id}>{href ? <Link href={href} className={`block px-5 py-3 ${rowLink}`}>{body}</Link> : <div className="px-5 py-3">{body}</div>}</li>; })}</ul> : <div className="p-6 text-center"><Bell className="mx-auto text-line-strong" size={22} aria-hidden="true"/><p className="mt-2 text-sm text-fg-muted">Hələ bildiriş yoxdur.</p></div>}</section>
    <section className={panel}>{panelHead("Kataloq", "Son məhsullar", { href: `/vendor/${storeId}/products`, label: "Kataloqa bax" })}{products.length ? <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">{products.map((product:any)=><Link key={product.id} href={`/vendor/${storeId}/products/${product.id}`} className={`group flex min-w-0 items-center gap-3 rounded-control border border-transparent bg-surface-page p-3 transition-colors hover:border-brand-200 hover:bg-white ${focusRing}`}><div className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-control bg-white text-center text-[9px] text-fg-muted">{product.images?.[0]?<Image src={product.images[0]} alt="" fill sizes="56px" unoptimized={/^https?:\/\//i.test(product.images[0])} className="object-cover"/>:"Şəkil yoxdur"}</div><span className="min-w-0"><span className="block truncate text-sm font-medium text-fg group-hover:text-primary">{product.name}</span><span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">{Number(product.price).toFixed(2)} AZN <Badge tone={productStatusTone(product.status)}>{productStatusLabels[product.status] ?? "Status məlum deyil"}</Badge></span></span></Link>)}</div> : <EmptyState className="rounded-none border-0" titleAs="h3" icon={<Package size={24}/>} title="Məhsul yoxdur" description="Kataloqunuzu ilk məhsulla yaradın." action={<ButtonLink href={`/vendor/${storeId}/products/new`} size="sm"><Plus size={15} aria-hidden="true"/> Məhsul əlavə et</ButtonLink>}/>}</section>
  </div>;
}

type StatCardData = { label: string; value: number | string; href: string; Icon: typeof Package; attention?: "warning" | "danger" | null };

/** One number. `attention` (set only while the number is above 0) turns the card gold or red and swaps in a warning icon. */
function StatCard({ card, storeId }: { card: StatCardData; storeId: string }) {
  const { label, value, href, Icon, attention } = card;
  const surface = attention === "danger" ? "border-[#f1b9b9] bg-danger-subtle hover:border-danger" : attention === "warning" ? "border-gold-400 bg-[#faf5ec] hover:border-gold-600" : "border-line bg-white hover:border-brand-200";
  const icon = attention === "danger" ? "bg-white text-danger ring-[#f5c6c6]" : attention === "warning" ? "bg-white text-gold-700 ring-gold-200" : "bg-primary-subtle text-primary ring-brand-100";
  const number = attention === "danger" ? "text-danger" : attention === "warning" ? "text-gold-700" : "text-fg";
  return <Link href={`/vendor/${storeId}/${href}`} data-attention={attention ?? undefined} className={`group flex min-h-[7.5rem] flex-col rounded-card border p-4 transition-[border-color,box-shadow] duration-150 hover:shadow-subtle motion-reduce:transition-none sm:p-5 ${surface} ${focusRing}`}>
    <span className="flex items-start justify-between gap-3"><span aria-hidden="true" className={`grid h-10 w-10 place-items-center rounded-full ring-1 ring-inset ${icon}`}>{attention ? <AlertTriangle size={18}/> : <Icon size={18}/>}</span><ArrowUpRight size={16} aria-hidden="true" className="text-line-strong transition-colors group-hover:text-primary"/></span>
    <span className="mt-auto pt-3 text-xs leading-5 text-fg-secondary">{label}</span>
    <span className={`mt-0.5 text-2xl font-semibold tracking-tight ${number}`}>{value}</span>
  </Link>;
}
