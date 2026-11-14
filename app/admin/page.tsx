import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import AdminVerificationSummary from "@/components/admin-verification-summary";
import { AdminStatusBadge } from "@/components/admin-ui/admin-status-badge";
import { EmptyState } from "@/components/admin-ui/empty-state";
import { PageHeader } from "@/components/admin-ui/page-header";
import { Section } from "@/components/admin-ui/section";
import { StatCard } from "@/components/admin-ui/stat-card";
import { buttonClass, focusRing } from "@/components/admin-ui/styles";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ADMIN_PENDING_ORDER_STATUSES, ADMIN_PENDING_ORDERS_HREF } from "@/lib/admin-order-filters";
import { formatMoney } from "@/lib/format-money";
import { getSetting } from "@/lib/settings/read";
import { SETTING_KEYS } from "@/lib/settings/registry";

export const dynamic = "force-dynamic";

/** Admin dashboard (İcmal): live counts and recent records. Same queries and links as before Phase B; UI kit layout. */
export default async function AdminDashboard() {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  const [customers, vendors, stores, activeStores, pendingStores, products, activeProducts, orders, pendingOrders, completedOrders, cancelledOrders, subscriptions, recentOrders, recentStores, maintenanceOn] = await Promise.all([
    prisma.user.count({ where: { role: "CUSTOMER" } }),
    prisma.user.count({ where: { role: "VENDOR" } }),
    prisma.store.count(),
    prisma.store.count({ where: { status: "ACTIVE", isActive: true } }),
    prisma.store.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.product.count(),
    prisma.product.count({ where: { status: "ACTIVE" } }),
    prisma.order.count(),
    prisma.order.count({ where: { status: { in: [...ADMIN_PENDING_ORDER_STATUSES] } } }),
    prisma.order.count({ where: { status: "DELIVERED" } }),
    prisma.order.count({ where: { status: "CANCELLED" } }),
    prisma.storeSubscription.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.order.findMany({ take: 6, orderBy: { createdAt: "desc" }, select: { id: true, status: true, total: true, createdAt: true, user: { select: { email: true } } } }),
    prisma.store.findMany({ take: 5, orderBy: { createdAt: "desc" }, select: { id: true, name: true, status: true, city: { select: { name: true } } } }),
    getSetting<boolean>(SETTING_KEYS.maintenanceEnabled),
  ]);
  const stats = [
    ["Müştərilər", customers, "/admin/customers"],
    ["Satıcılar", vendors, "/admin/vendors"],
    ["Mağazalar", stores, "/admin/stores"],
    ["Aktiv mağazalar", activeStores, "/admin/stores?status=ACTIVE"],
    ["Yoxlama gözləyir", pendingStores, "/admin/stores?status=PENDING_REVIEW"],
    ["Məhsullar", products, "/admin/products"],
    ["Aktiv məhsullar", activeProducts, "/admin/products?status=ACTIVE"],
    ["Sifarişlər", orders, "/admin/orders"],
    ["Gözləyən sifarişlər", pendingOrders, ADMIN_PENDING_ORDERS_HREF],
    ["Çatdırılıb", completedOrders, "/admin/orders?status=DELIVERED"],
    ["Ləğv edilib", cancelledOrders, "/admin/orders?status=CANCELLED"],
  ] as const;
  const seeAll = (href: string, label: string) => <Link href={href} className={`rounded text-sm text-[#85621d] ${focusRing}`}>{label} →</Link>;
  return <AdminShell email={admin.email}>
    {maintenanceOn === true && <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-red-900">
      <p><b>Texniki iş rejimi açıqdır.</b> Müştəri və satıcı səhifələri və API-ləri 503 qaytarır; alış-veriş dayanıb. Admin paneli və ödəniş bildirişləri işləyir.</p>
      <Link href="/admin/settings?tab=maintenance" className={buttonClass("danger")}>Rejimi idarə et</Link>
    </div>}
    <PageHeader
      eyebrow="BAGATI İDARƏETMƏ"
      title="İcmal"
      description="Göstəricilər canlı PostgreSQL qeydlərindən hesablanır."
      actions={<Link href="/admin/stores?status=PENDING_REVIEW" className={buttonClass("primary")}>Yoxlanmalı mağazalar · {pendingStores}</Link>}
    />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map(([label, value, href]) => <StatCard key={label} label={label} value={value} href={href} />)}
    </div>
    <AdminVerificationSummary />
    <div className="mt-7 grid gap-5 xl:grid-cols-2">
      <Section title="Abunəlik statusları" actions={seeAll("/admin/subscriptions", "Baxış")}>
        {subscriptions.length
          ? <div className="grid gap-2 sm:grid-cols-2">{subscriptions.map((row) => <div key={row.status} className="flex items-center justify-between rounded-xl bg-[#f8f7f4] px-4 py-3 text-sm"><AdminStatusBadge kind="subscription" value={row.status} /><b>{row._count._all}</b></div>)}</div>
          : <EmptyState title="Abunəlik qeydi yoxdur." />}
      </Section>
      <Section title="Son sifarişlər" actions={seeAll("/admin/orders", "Hamısı")}>
        {recentOrders.length
          ? <div className="divide-y">{recentOrders.map((order) => <Link href={`/admin/orders/${order.id}`} key={order.id} className={`flex flex-wrap items-center justify-between gap-2 py-3 text-sm ${focusRing}`}><span className="min-w-0 break-all">#{order.id.slice(-8).toUpperCase()} · {order.user.email}</span><span className="flex items-center gap-2"><AdminStatusBadge kind="order" value={order.status} /><span className="whitespace-nowrap">{formatMoney(order.total)}</span></span></Link>)}</div>
          : <EmptyState title="Sifariş yoxdur." />}
      </Section>
    </div>
    <Section className="mt-5" title="Yeni mağazalar" actions={seeAll("/admin/stores", "Hamısı")}>
      {recentStores.length
        ? <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{recentStores.map((store) => <Link key={store.id} href={`/admin/stores/${store.id}`} className={`rounded-xl bg-[#f8f7f4] p-4 ${focusRing}`}><b>{store.name}</b><p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500"><span>{store.city.name}</span><AdminStatusBadge kind="store" value={store.status} /></p></Link>)}</div>
        : <EmptyState title="Mağaza yoxdur." />}
    </Section>
  </AdminShell>;
}
