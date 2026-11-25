"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, ClipboardList, ImageOff, Search } from "lucide-react";
import { allowedVendorOrderTransitions, statusLabel } from "@/lib/order-status";
import { VendorPageHeader } from "@/components/vendor-page-header";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cx, focusRing } from "@/components/ui/cx";
import { orderStatusTone, paymentStatusTone } from "@/lib/vendor-status-tone";
import { buttonClass } from "@/components/ui/button";
import { vendorInput } from "@/components/vendor-form";
import { buildOrderTabs, formatOrderDateTime, needsAttention, orderNumber, storeOrderTotal, type OrderStatusCounts } from "@/lib/vendor-order-view";

type VendorOrder = {
  id: string;
  status: string;
  subtotal: number | string;
  deliveryFee?: number | string;
  createdAt: string;
  order: { id: string; createdAt: string };
  payment?: { status: string | null; label: string };
  items: { id: string; productName: string; quantity: number; variant?: { name: string } | null; image?: string | null }[];
};

type OrderPage = { items: VendorOrder[]; page: number; pageSize: number; total: number; totalPages: number; counts?: OrderStatusCounts };

/**
 * Seller order list (SELLER-ORDERS-DESIGN-1). Same data, search, paging and status change as before; only the layout
 * changed: status tabs with real counts (one grouped query in the same GET), a table from 1024 px, cards below it.
 * NEW/PENDING orders get a gold edge and tint; the status text badge stays the signal (not colour alone).
 */
export default function VendorOrders({ storeId }: { storeId: string }) {
  const [result, setResult] = useState<OrderPage>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (status) query.set("status", status);
    if (search.trim().length >= 2) query.set("q", search.trim());
    fetch(`/api/vendor/${encodeURIComponent(storeId)}/orders?${query}`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Sifarişləri yükləmək mümkün olmadı.");
        if (active) setResult(data);
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Sifarişləri yükləmək mümkün olmadı."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `query` is the debounced value of `search`.
  }, [storeId, page, status, query]);

  async function updateStatus(orderId: string, nextStatus: string) {
    const confirmations: Record<string, string> = {
      CANCELLED: "Sifarişi ləğv etmək istədiyinizə əminsiniz? Alıcıya bildiriş göndəriləcək və məhsullar anbara geri qaytarılacaq. Bu addımı geri almaq olmur.",
      RETURNED: "Sifarişi qaytarılmış kimi qeyd etmək istədiyinizə əminsiniz? Bu addımı geri almaq olmur.",
    };
    if (confirmations[nextStatus] && !window.confirm(confirmations[nextStatus])) return;
    setBusyId(orderId);
    setError("");
    try {
      const response = await fetch(`/api/vendor/${encodeURIComponent(storeId)}/orders`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId, status: nextStatus }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sifariş statusu yenilənmədi.");
      const query = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (status) query.set("status", status);
      if (search.trim().length >= 2) query.set("q", search.trim());
      const refreshed = await fetch(`/api/vendor/${encodeURIComponent(storeId)}/orders?${query}`);
      if (refreshed.ok) setResult(await refreshed.json());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sifariş statusu yenilənmədi.");
    } finally {
      setBusyId("");
    }
  }

  const tabs = buildOrderTabs(result.counts ?? { total: 0, byStatus: {} }, status);
  const href = (order: VendorOrder) => `/vendor/${storeId}/orders/${order.id}`;
  const total = (order: VendorOrder) => `${storeOrderTotal(order).toFixed(2)} ₼`;
  const firstItem = (order: VendorOrder) => order.items[0] ? `${order.items[0].productName}${order.items[0].variant ? ` · ${order.items[0].variant.name}` : ""} × ${order.items[0].quantity}` : "";
  const moreItems = (order: VendorOrder) => order.items.length > 1 ? `və daha ${order.items.length - 1} məhsul` : "";
  const statusChange = (order: VendorOrder, compact = false) => {
    const transitions = allowedVendorOrderTransitions(order.status);
    if (!transitions.length) return <span className={cx("text-xs text-fg-muted", compact && "w-40 shrink-0 text-right")}>Status dəyişdirilə bilməz</span>;
    return <label className={cx("flex min-w-0 items-center gap-2 text-xs text-fg-muted", compact && "shrink-0")}><span className={compact ? "sr-only" : "shrink-0"}>Statusu dəyiş</span>
      <select aria-label={`Sifariş ${order.order.id} üçün yeni status`} disabled={busyId === order.id} defaultValue="" onChange={event => { if (event.target.value) void updateStatus(order.id, event.target.value); }} className={cx(vendorInput, "min-w-0", compact && "!w-40 shrink-0")}>
        <option value="" disabled>Keçid seçin</option>{transitions.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}
      </select>
    </label>;
  };
  // SELLER-ORDERS-DESIGN-2: 40 px image of the first line (the API sends only its first URL); the "no image" icon otherwise.
  const thumbnail = (order: VendorOrder) => {
    const first = order.items[0];
    if (!first) return null;
    return <span data-order-thumb="" className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-control border border-line bg-surface-page">{first.image
      // eslint-disable-next-line @next/next/no-img-element -- a 40 px thumbnail; next/image would add client JS to this list
      ? <img src={first.image} alt={first.productName} width={40} height={40} loading="lazy" className="h-full w-full object-cover"/>
      : <ImageOff aria-hidden="true" size={16} strokeWidth={2} className="text-fg-muted"/>}</span>;
  };
  const badges = (order: VendorOrder) => <span className="flex flex-wrap gap-1.5"><Badge tone={orderStatusTone(order.status)}>{statusLabel(order.status)}</Badge>{order.payment && <Badge tone={paymentStatusTone(order.payment.status)}>{order.payment.label}</Badge>}</span>;

  return <section className="space-y-5">
    <VendorPageHeader eyebrow="SİFARİŞLƏRİN İDARƏ EDİLMƏSİ" title="Sifarişlər" description={`Bu mağazaya aid ${result.total} sifariş`}/>
    <div className="grid min-w-0 gap-4 rounded-card border border-line bg-white p-4 sm:p-5">
      <label className="grid gap-1.5 text-sm font-medium text-fg">Axtar
        <span className="relative block"><Search aria-hidden="true" size={18} strokeWidth={2} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-muted"/>
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Sifariş nömrəsi və ya məhsul adı" className={cx(vendorInput, "!pl-10")}/></span>
      </label>
      <div role="group" aria-label="Status üzrə süzgəc" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:thin] sm:-mx-5 sm:px-5 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
        {tabs.map(tab => {
          const active = status === tab.status;
          return <button key={tab.status || "all"} type="button" data-order-tab={tab.status || "ALL"} aria-pressed={active} onClick={() => { setStatus(tab.status); setPage(1); }}
            className={cx("inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors motion-reduce:transition-none", focusRing,
              active ? "border-primary bg-primary text-white" : "border-line-strong bg-white text-fg hover:border-primary hover:text-primary")}>
            {tab.label}
            <span className={cx("min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums", active ? "bg-white/20 text-white" : tab.status === "NEW" && tab.count > 0 ? "bg-gold-100 text-gold-700 ring-1 ring-inset ring-gold-200" : "bg-surface-sunken text-fg-body")}>{tab.count}</span>
          </button>;
        })}
      </div>
    </div>
    {error && <p role="alert" className="rounded-control border border-[#f1b9b9] bg-danger-subtle p-3 text-sm font-medium text-danger">{error}</p>}
    {loading ? <div role="status" className="rounded-card border border-line bg-white p-8 text-center text-sm text-fg-muted">Sifarişlər yüklənir…</div> : result.items.length ? <>
      {/* Desktop table (1280 px and wider; the content area is too narrow for 6 columns below that) */}
      <div className="hidden overflow-hidden rounded-card border border-line bg-white xl:block">
        <table className="w-full table-fixed text-left text-sm" data-vendor-orders-table="">
          <thead className="border-b border-line bg-surface-page text-xs font-semibold uppercase tracking-wide text-fg-secondary">
            <tr><th scope="col" className="w-[14%] px-3 py-3 pl-4">Sifariş</th><th scope="col" className="w-[19%] px-3 py-3">Məhsullar</th><th scope="col" className="w-[10%] px-3 py-3 text-right">Cəmi</th><th scope="col" className="w-[13%] px-3 py-3">Status</th><th scope="col" className="w-[14%] px-3 py-3">Ödəniş</th><th scope="col" className="w-[30%] px-3 py-3 pr-4"><span className="sr-only">Statusu dəyiş</span></th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {result.items.map(order => {
              const attention = needsAttention(order.status);
              return <tr key={order.id} data-order-row={order.status} className={cx("align-middle transition-colors hover:bg-surface-page", attention && "bg-[#fbf6ec] hover:bg-[#f8f0e0]")}>
                <td className={cx("px-3 py-3.5 pl-4", attention && "shadow-[inset_4px_0_0_var(--bagati-gold-400)]")}><Link href={href(order)} className={cx("font-semibold text-primary underline-offset-2 hover:underline", focusRing)}>{orderNumber(order.order.id)}</Link><span className="mt-0.5 block text-xs tabular-nums text-fg-muted">{formatOrderDateTime(order.createdAt)}</span></td>
                <td className="px-3 py-3.5"><div className="flex min-w-0 items-center gap-2.5">{thumbnail(order)}<div className="min-w-0"><span className="block truncate text-fg-body" title={firstItem(order)}>{firstItem(order)}</span>{moreItems(order) && <span className="block text-xs text-fg-muted">{moreItems(order)}</span>}</div></div></td>
                <td className="whitespace-nowrap px-3 py-3.5 text-right font-semibold tabular-nums text-fg">{total(order)}</td>
                <td className="px-3 py-3.5"><Badge tone={orderStatusTone(order.status)} className="whitespace-nowrap">{statusLabel(order.status)}</Badge></td>
                <td className="px-3 py-3.5">{order.payment ? <Badge tone={paymentStatusTone(order.payment.status)} className="whitespace-nowrap">{order.payment.label}</Badge> : null}</td>
                <td className="px-3 py-3.5 pr-4"><div className="flex items-center justify-end gap-2">{statusChange(order, true)}<Link href={href(order)} aria-label={`${orderNumber(order.order.id)} — Ətraflı`} className={cx(buttonClass({ variant: "secondary", size: "sm" }), "shrink-0 px-3")}>Ətraflı<ChevronRight aria-hidden="true" size={16} strokeWidth={2}/></Link></div></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {/* Cards (below 1280 px): no sideways scroll, 44 px targets */}
      <ul className="grid gap-3 xl:hidden">
        {result.items.map(order => {
          const attention = needsAttention(order.status);
          return <li key={order.id} data-order-card={order.status} className={cx("min-w-0 rounded-card border bg-white p-4", attention ? "border-gold-200 bg-[#fbf6ec] shadow-[inset_4px_0_0_var(--bagati-gold-400)]" : "border-line")}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><Link href={href(order)} className={cx("font-semibold text-primary underline-offset-2 hover:underline", focusRing)}>Sifariş {orderNumber(order.order.id)}</Link><p className="mt-0.5 text-xs tabular-nums text-fg-muted">{formatOrderDateTime(order.createdAt)}</p></div>
              <b className="shrink-0 text-base tabular-nums text-fg">{total(order)}</b>
            </div>
            <div className="mt-2.5">{badges(order)}</div>
            <div className="mt-3 flex min-w-0 items-center gap-3">{thumbnail(order)}<div className="min-w-0"><p className="truncate text-sm text-fg-body">{firstItem(order)}</p>
              {moreItems(order) && <p className="text-xs text-fg-muted">{moreItems(order)}</p>}</div></div>
            <div className="mt-3 grid gap-2 border-t border-line pt-3 min-[420px]:grid-cols-[minmax(0,1fr)_auto] min-[420px]:items-center">
              {statusChange(order)}
              <Link href={href(order)} className={buttonClass({ variant: "secondary", size: "sm" })}>Ətraflı<ChevronRight aria-hidden="true" size={16} strokeWidth={2}/></Link>
            </div>
          </li>;
        })}
      </ul>
    </> : <EmptyState icon={<ClipboardList size={24}/>} title={query ? "Axtarışa uyğun sifariş tapılmadı." : status ? "Bu statusda sifariş yoxdur." : "Hələ sifariş yoxdur."} description="Yeni sifarişlər bu bölmədə görünəcək."/>}
    <footer className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="tabular-nums text-fg-muted">{result.total ? `${(result.page - 1) * result.pageSize + 1}–${Math.min(result.page * result.pageSize, result.total)} / ${result.total}` : "0 sifariş"}</span><div className="flex gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => Math.max(1, value - 1))} className={buttonClass({ variant: "secondary", size: "sm" })}>Əvvəlki</button><button type="button" disabled={page >= result.totalPages || loading} onClick={() => setPage(value => value + 1)} className={buttonClass({ variant: "secondary", size: "sm" })}>Növbəti</button></div></footer>
  </section>;
}
