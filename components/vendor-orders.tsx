"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { allowedVendorOrderTransitions, statusLabel, VENDOR_ORDER_STATUSES } from "@/lib/order-status";

type VendorOrder = {
  id: string;
  status: string;
  subtotal: number | string;
  deliveryFee?: number | string;
  createdAt: string;
  order: { id: string; createdAt: string };
  items: { id: string; productName: string; quantity: number; variant?: { name: string } | null }[];
};

type OrderPage = { items: VendorOrder[]; page: number; pageSize: number; total: number; totalPages: number };
const legacyStatuses = ["PENDING", "PROCESSING", "SHIPPED"];

export default function VendorOrders({ storeId }: { storeId: string }) {
  const [result, setResult] = useState<OrderPage>({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (status) query.set("status", status);
    fetch(`/api/vendor/${encodeURIComponent(storeId)}/orders?${query}`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Sifarişləri yükləmək mümkün olmadı.");
        if (active) setResult(data);
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Sifarişləri yükləmək mümkün olmadı."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [storeId, page, status]);

  async function updateStatus(orderId: string, nextStatus: string) {
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
      const refreshed = await fetch(`/api/vendor/${encodeURIComponent(storeId)}/orders?${query}`);
      if (refreshed.ok) setResult(await refreshed.json());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sifariş statusu yenilənmədi.");
    } finally {
      setBusyId("");
    }
  }

  return <section className="space-y-5">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="text-sm font-medium text-[#967844]">SİFARİŞLƏRİN İDARƏ EDİLMƏSİ</p><h1 className="mt-1 text-3xl font-semibold text-[#142d38]">Sifarişlər</h1><p className="mt-2 text-sm text-slate-500">Bu mağazaya aid {result.total} sifariş</p></div>
      <label className="grid gap-1 text-sm text-slate-600">Status üzrə süzgəc
        <select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} className="min-h-11 min-w-52 rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5">
          <option value="">Bütün statuslar</option>
          {[...legacyStatuses, ...VENDOR_ORDER_STATUSES].map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
      </label>
    </header>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {loading ? <div className="rounded-2xl border border-[#e9e4da] bg-white p-8 text-center text-sm text-slate-500">Sifarişlər yüklənir…</div> : result.items.length ? <div className="space-y-3">
      {result.items.map(order => {
        const transitions = allowedVendorOrderTransitions(order.status);
        return <article key={order.id} className="rounded-2xl border border-[#e9e4da] bg-white p-4 shadow-[0_8px_24px_rgba(11,23,38,.03)] sm:p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div><Link href={`/vendor/${storeId}/orders/${order.id}`} className="font-semibold text-[#173c40] hover:underline">Sifariş #{order.order.id.slice(-8).toUpperCase()}</Link><p className="mt-1 text-xs text-slate-500">{new Date(order.createdAt).toLocaleString("az-AZ")}</p></div>
            <div className="flex items-center justify-between gap-3 sm:justify-end"><span className="rounded-full bg-[#f3f1eb] px-3 py-1.5 text-xs font-medium text-[#536273]">{statusLabel(order.status)}</span><b className="text-sm text-[#142d38]">{(Number(order.subtotal) + Number(order.deliveryFee ?? 0)).toFixed(2)} ₼</b></div>
          </div>
          <div className="mt-4 grid gap-1 text-sm text-slate-600">{order.items.slice(0, 3).map(item => <p key={item.id} className="truncate">{item.productName}{item.variant ? ` · ${item.variant.name}` : ""} × {item.quantity}</p>)}{order.items.length > 3 && <p className="text-xs text-slate-500">və daha {order.items.length - 3} məhsul</p>}</div>
          <div className="mt-4 flex flex-col gap-2 border-t border-[#eeeae2] pt-4 sm:flex-row sm:items-center sm:justify-between">
            {transitions.length ? <label className="flex items-center gap-2 text-xs text-slate-500">Statusu dəyiş
              <select aria-label={`Sifariş ${order.order.id} üçün yeni status`} disabled={busyId === order.id} defaultValue="" onChange={event => { if (event.target.value) void updateStatus(order.id, event.target.value); }} className="min-h-10 rounded-lg border border-[#ded9cf] bg-white px-2 text-sm text-[#243647]">
                <option value="" disabled>Keçid seçin</option>{transitions.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}
              </select>
            </label> : <span className="text-xs text-slate-500">Status dəyişdirilə bilməz</span>}
            <Link href={`/vendor/${storeId}/orders/${order.id}`} className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[#d9d4c9] px-4 text-sm font-medium text-[#173c40] transition hover:bg-[#f8f7f4]">Ətraflı</Link>
          </div>
        </article>;
      })}
    </div> : <div className="rounded-2xl border border-[#e9e4da] bg-white p-8 text-center"><p className="font-medium text-[#243647]">{status ? "Bu statusda sifariş yoxdur." : "Hələ sifariş yoxdur."}</p><p className="mt-1 text-sm text-slate-500">Yeni sifarişlər bu bölmədə görünəcək.</p></div>}
    <footer className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-slate-500">{result.total ? `${(result.page - 1) * result.pageSize + 1}–${Math.min(result.page * result.pageSize, result.total)} / ${result.total}` : "0 sifariş"}</span><div className="flex gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => Math.max(1, value - 1))} className="min-h-10 rounded-lg border bg-white px-3 disabled:opacity-40">Əvvəlki</button><button type="button" disabled={page >= result.totalPages || loading} onClick={() => setPage(value => value + 1)} className="min-h-10 rounded-lg border bg-white px-3 disabled:opacity-40">Növbəti</button></div></footer>
  </section>;
}
