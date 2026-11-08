import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { paymentStatusLabel, statusLabel } from "@/lib/order-status";
import { EmptyState } from "@/components/state-panel";
import { decodeCustomerOrderCursor, listCustomerOrderPage } from "@/lib/customer-order-pagination";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const user = await currentUser();
  if (!user || user.role !== "CUSTOMER") redirect("/login?next=%2Forders");
  const { cursor } = await searchParams;
  const validCursor = cursor ? decodeCustomerOrderCursor(cursor) : null;
  const invalidCursor = Boolean(cursor && !validCursor);
  const page = await listCustomerOrderPage(prisma, user.id, { cursor: validCursor ? cursor : undefined });
  const pageHref = (value: string | null) => value ? `/orders?cursor=${encodeURIComponent(value)}` : "/orders";

  return <div className="container py-10 md:py-14">
    <p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald">Hesabım</p>
    <h1 className="mt-2 text-3xl font-semibold">Sifarişlərim</h1>
    {invalidCursor && <p role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Səhifə keçidi etibarsızdır. İlk səhifə göstərilir.</p>}
    {page.items.length ? <>
      <div className="mt-7 space-y-4">{page.items.map((order) => <Link href={`/orders/${order.id}`} key={order.id} className="block rounded-2xl border border-line bg-white p-5 transition hover:border-emerald/40 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">Sifariş · {order.id.slice(-8).toUpperCase()}</p><p className="mt-1 text-sm text-muted">{order.createdAt.toLocaleDateString("az-AZ")}</p></div>
          <div className="text-right"><p className="font-semibold">{Number(order.total).toFixed(2)} ₼</p><p className="mt-1 text-sm text-muted">{statusLabel(order.status)}</p><p className="mt-1 text-xs text-muted">Son ödəniş cəhdi: {paymentStatusLabel(order.payments[0]?.status)}</p></div></div>
        <div className="mt-4 flex flex-wrap gap-2">{order.storeOrders.map((storeOrder) => <span key={storeOrder.id} className="rounded-full bg-paper px-3 py-1.5 text-xs text-muted">{storeOrder.store.name} · {storeOrder._count.items} məhsul</span>)}</div>
        <p className="mt-4 text-sm text-emerald">Sifarişə bax →</p>
      </Link>)}</div>
      <nav aria-label="Sifariş səhifələri" className="mt-7 flex flex-wrap justify-between gap-3">
        {page.hasPrevious && page.previousCursor ? <Link rel="prev" href={pageHref(page.previousCursor)} className="min-h-11 rounded-xl border border-line bg-white px-4 py-3 text-sm font-medium">← Daha yeni sifarişlər</Link> : <span/>}
        {page.hasNext && page.nextCursor ? <Link rel="next" href={pageHref(page.nextCursor)} className="min-h-11 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white">Daha köhnə sifarişlər →</Link> : <span className="self-center text-xs text-muted">Bütün sifarişlər göstərildi</span>}
      </nav>
    </> : <div className="mt-7"><EmptyState title={validCursor ? "Bu səhifədə sifariş yoxdur" : "Hələ sifariş yoxdur"} detail={validCursor ? "Sifarişlər yenilənmiş ola bilər. Əvvəlki səhifəyə qayıdın." : "Mağazaları kəşf edib ilk sifarişinizi verə bilərsiniz."}/>{page.hasPrevious && page.previousCursor ? <Link rel="prev" href={pageHref(page.previousCursor)} className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-line bg-white px-4 py-3 text-sm font-medium">← Daha yeni sifarişlər</Link> : !validCursor && <Link href="/stores" className="mt-5 inline-block text-sm font-medium text-emerald">Mağazalara bax →</Link>}{page.hasNext && page.nextCursor && <Link rel="next" href={pageHref(page.nextCursor)} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-ink px-4 py-3 text-sm font-medium text-white">{"N\u00f6vb\u0259ti n\u0259tic\u0259l\u0259ri yoxla \u2192"}</Link>}</div>}
  </div>;
}
