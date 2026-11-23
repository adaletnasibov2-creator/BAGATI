import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { paymentStatusLabel, statusLabel } from "@/lib/order-status";
import { EmptyState } from "@/components/ui/empty-state";
import { AccountShell } from "@/components/account-shell";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { customerMessagesBadge } from "@/lib/messaging-pages";
import { orderStatusTone, paymentStatusTone } from "@/lib/vendor-status-tone";
import { Package } from "lucide-react";
import { decodeCustomerOrderCursor, listCustomerOrderPage } from "@/lib/customer-order-pagination";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const user = await currentUser();
  if (!user || user.role !== "CUSTOMER") redirect("/login?next=%2Forders");
  const { cursor } = await searchParams;
  const validCursor = cursor ? decodeCustomerOrderCursor(cursor) : null;
  const invalidCursor = Boolean(cursor && !validCursor);
  const [page, messagesUnread] = await Promise.all([
    listCustomerOrderPage(prisma, user.id, { cursor: validCursor ? cursor : undefined }),
    // The account navigation shows "Mesajlarım" only while messaging is on (null = hidden), like the other account pages.
    customerMessagesBadge(user.id),
  ]);
  const pageHref = (value: string | null) => value ? `/orders?cursor=${encodeURIComponent(value)}` : "/orders";

  return <AccountShell title="Sifarişlərim" messagesUnread={messagesUnread}>
    {invalidCursor && <p role="alert" className="mb-4 rounded-control border border-gold-200 bg-[#faf5ec] p-3 text-sm font-medium text-gold-700">Səhifə keçidi etibarsızdır. İlk səhifə göstərilir.</p>}
    {page.items.length ? <>
      <ul className="space-y-4">{page.items.map((order) => <li key={order.id}><Link href={`/orders/${order.id}`} data-account-order-card="" className="block rounded-card border border-line bg-white p-5 transition-colors hover:border-brand-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-fg">Sifariş · {order.id.slice(-8).toUpperCase()}</p><p className="mt-1 text-sm text-fg-muted">{order.createdAt.toLocaleDateString("az-AZ")}</p></div>
          <div className="flex flex-col items-end gap-1.5 text-right"><p className="text-lg font-semibold text-fg">{Number(order.total).toFixed(2)} ₼</p><Badge tone={orderStatusTone(order.status)}>{statusLabel(order.status)}</Badge><p className="text-xs text-fg-muted">Son ödəniş cəhdi: <Badge tone={paymentStatusTone(order.payments[0]?.status)}>{paymentStatusLabel(order.payments[0]?.status)}</Badge></p></div></div>
        <div className="mt-4 flex flex-wrap gap-2">{order.storeOrders.map((storeOrder) => <span key={storeOrder.id} className="rounded-full bg-surface-sunken px-3 py-1.5 text-xs text-fg-body">{storeOrder.store.name} · {storeOrder._count.items} məhsul</span>)}</div>
        <p className="mt-4 text-sm font-medium text-primary">Sifarişə bax →</p>
      </Link></li>)}</ul>
      <nav aria-label="Sifariş səhifələri" className="mt-7 flex flex-wrap justify-between gap-3">
        {page.hasPrevious && page.previousCursor ? <Link rel="prev" href={pageHref(page.previousCursor)} className={buttonClass({ variant: "secondary", size: "sm" })}>← Daha yeni sifarişlər</Link> : <span/>}
        {page.hasNext && page.nextCursor ? <Link rel="next" href={pageHref(page.nextCursor)} className={buttonClass({ size: "sm" })}>Daha köhnə sifarişlər →</Link> : <span className="self-center text-xs text-fg-muted">Bütün sifarişlər göstərildi</span>}
      </nav>
    </> : <EmptyState icon={<Package size={24}/>} title={validCursor ? "Bu səhifədə sifariş yoxdur" : "Hələ sifariş yoxdur"} description={validCursor ? "Sifarişlər yenilənmiş ola bilər. Əvvəlki səhifəyə qayıdın." : "Mağazaları kəşf edib ilk sifarişinizi verə bilərsiniz."} action={<div className="flex flex-wrap justify-center gap-2">{page.hasPrevious && page.previousCursor ? <Link rel="prev" href={pageHref(page.previousCursor)} className={buttonClass({ variant: "secondary", size: "sm" })}>← Daha yeni sifarişlər</Link> : !validCursor && <Link href="/stores" className={buttonClass({ size: "sm" })}>Mağazalara bax →</Link>}{page.hasNext && page.nextCursor && <Link rel="next" href={pageHref(page.nextCursor)} className={buttonClass({ size: "sm" })}>{"N\u00f6vb\u0259ti n\u0259tic\u0259l\u0259ri yoxla \u2192"}</Link>}</div>}/>}
  </AccountShell>;
}
