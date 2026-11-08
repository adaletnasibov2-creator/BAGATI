"use client";

import { useCallback, useEffect, useState } from "react";
import { nextReturnStatus, returnStatusLabel, type ReturnResolutionValue, type ReturnStatusValue } from "@/lib/returns";

type Row = { id: string; reason: string; explanation: string | null; resolution: ReturnResolutionValue; status: ReturnStatusValue; refundAmount: string | number; vendorResponse: string | null; stockRestoredAt: string | null; createdAt: string; orderItem: { productName: string; variantName: string | null; variantOptions: unknown; quantity: number; unitPrice: string | number; lineTotal: string | number }; storeOrder: { id: string; orderId: string; createdAt: string }; customer: { customerProfile: { firstName: string | null; lastName: string | null } | null } };
const reasons: Record<string, string> = { WRONG_ITEM: "Yanlış məhsul", DAMAGED: "Zədələnmiş məhsul", MISSING_PARTS: "Hissə çatışmır", NOT_AS_DESCRIBED: "Təsvirə uyğun deyil", OTHER: "Digər səbəb" };

export function VendorReturns({ storeId }: { storeId: string }) {
  const [items, setItems] = useState<Row[]>([]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/vendor/${storeId}/returns`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) { setError(data.error || "Sorğular yüklənmədi."); return; }
    setItems(data.items || []);
  }, [storeId]);
  useEffect(() => { void load(); }, [load]);

  async function act(item: Row, action: "approve" | "reject" | "receive" | "restore-stock" | "process-resolution" | "complete-exchange") {
    setBusy(item.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/vendor/${storeId}/returns`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, action, response: responses[item.id] || undefined }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sorğu yenilənmədi.");
      setNotice("Sorğunun statusu yeniləndi."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Sorğu yenilənmədi."); }
    finally { setBusy(null); }
  }

  const panel = "rounded-2xl border border-[#e9e4da] bg-white p-5";
  return <section>
    <p className="text-sm font-medium text-[#967844]">SATIŞ İDARƏETMƏSİ</p><h1 className="mt-1 text-3xl font-semibold">Qaytarılmalar</h1>
    <p className="mt-2 text-sm text-slate-500">Sorğular yalnız bu mağazanın sifarişlərindən göstərilir. Qəbul təsdiqi stok sayını dəyişmir; yalnız yenidən satıla bilən məhsullar üçün ayrıca stok bərpası seçin.</p>
    {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-4 text-sm text-emerald-700">{notice}</p>}
    <div className="mt-5 grid gap-3">{items.map(item => {
      const customerName = [item.customer.customerProfile?.firstName, item.customer.customerProfile?.lastName].filter(Boolean).join(" ") || "Müştəri";
      const receiveStatus = nextReturnStatus(item.status, "receive", item.resolution);
      const nextResolution = nextReturnStatus(item.status, "process-resolution", item.resolution);
      const exchangeComplete = nextReturnStatus(item.status, "complete-exchange", item.resolution);
      return <article key={item.id} className={panel}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{item.orderItem.productName}{item.orderItem.variantName ? ` · ${item.orderItem.variantName}` : ""}</h2><p className="mt-1 text-sm text-slate-500">Sifariş #{item.storeOrder.orderId.slice(-8).toUpperCase()} · {customerName} · {new Date(item.createdAt).toLocaleDateString("az-AZ")}</p></div><span className="rounded-full bg-[#f7f5ef] px-3 py-1.5 text-xs font-medium">{returnStatusLabel(item.status)}</span></div>
        <div className="mt-3 grid gap-1 text-sm text-slate-600 sm:grid-cols-2"><p>Səbəb: {reasons[item.reason] || item.reason}</p><p>Həll: {item.resolution === "REFUND" ? "Geri ödəniş" : "Dəyişdirilmə"}</p><p>Miqdar: {item.orderItem.quantity} ədəd</p><p>Sifarişdə tutulan məbləğ: {Number(item.refundAmount).toFixed(2)} ₼</p></div>
        {item.explanation && <p className="mt-3 rounded-xl bg-[#f8f7f4] p-3 text-sm">{item.explanation}</p>}
        <label className="mt-3 block text-sm">Müştəriyə cavab<textarea maxLength={2000} rows={2} value={responses[item.id] ?? item.vendorResponse ?? ""} onChange={event => setResponses(current => ({ ...current, [item.id]: event.target.value }))} className="mt-1 w-full rounded-xl border border-[#ded9cf] px-3 py-2.5"/></label>
        <div className="mt-3 flex flex-wrap gap-2">
          {item.status === "REQUESTED" && <><button disabled={busy === item.id} onClick={() => void act(item, "approve")} className="min-h-10 rounded-lg bg-[#173c40] px-3 text-sm text-white">Təsdiqlə</button><button disabled={busy === item.id} onClick={() => void act(item, "reject")} className="min-h-10 rounded-lg border px-3 text-sm">Rədd et</button></>}
          {receiveStatus && <button disabled={busy === item.id} onClick={() => void act(item, "receive")} className="min-h-10 rounded-lg bg-[#173c40] px-3 text-sm text-white">Məhsulu qəbul et</button>}
          {item.status === "ITEM_RECEIVED" && !item.stockRestoredAt && <button disabled={busy === item.id} onClick={() => void act(item, "restore-stock")} className="min-h-10 rounded-lg border border-[#d9d4c9] px-3 text-sm">Məhsul yenidən satıla bilirsə, stoku bərpa et</button>}
          {nextResolution && <button disabled={busy === item.id} onClick={() => void act(item, "process-resolution")} className="min-h-10 rounded-lg bg-[#173c40] px-3 text-sm text-white">{item.resolution === "REFUND" ? "Geri ödənişi gözləməyə göndər" : "Dəyişdirilməni hazırla"}</button>}
          {exchangeComplete && <button disabled={busy === item.id} onClick={() => void act(item, "complete-exchange")} className="min-h-10 rounded-lg bg-[#173c40] px-3 text-sm text-white">Dəyişdirilməni tamamla</button>}
        </div>
        {item.status === "REFUND_PENDING" && <p className="mt-3 text-xs leading-5 text-amber-800">Geri ödəniş provayder inteqrasiyası olmadığı üçün gözləyir. Bu panel xarici ödənişi tamamlanmış kimi göstərmir.</p>}
        {item.stockRestoredAt && <p className="mt-2 text-xs text-emerald-700">Stok bərpa edildi · {new Date(item.stockRestoredAt).toLocaleString("az-AZ")}</p>}
      </article>;
    })}{!items.length && <div className={panel}><p className="text-sm text-slate-500">Bu mağaza üçün qaytarılma sorğusu yoxdur.</p></div>}</div>
  </section>;
}
