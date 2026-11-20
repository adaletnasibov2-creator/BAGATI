"use client";

import { FormEvent, useEffect, useState } from "react";
import { returnStatusLabel, type ReturnStatusValue } from "@/lib/returns";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { returnStatusTone } from "@/lib/vendor-status-tone";

type EligibleItem = { id: string; productName: string; variantName: string | null; quantity: number; unitPrice: string | number; lineTotal: string | number; storeOrder: { id: string; createdAt: string; store: { name: string } } };
type ReturnRequestRow = { id: string; reason: string; explanation: string | null; resolution: "REFUND" | "EXCHANGE"; status: ReturnStatusValue; refundAmount: string | number; vendorResponse: string | null; createdAt: string; orderItem: { productName: string; variantName: string | null; quantity: number; unitPrice: string | number }; storeOrder: { orderId: string; store: { name: string } } };

const reasonLabels: Record<string, string> = { WRONG_ITEM: "Yanlış məhsul", DAMAGED: "Zədələnmiş məhsul", MISSING_PARTS: "Hissə çatışmır", NOT_AS_DESCRIBED: "Təsvirə uyğun deyil", OTHER: "Digər səbəb" };

export function CustomerReturns() {
  const [eligible, setEligible] = useState<EligibleItem[]>([]);
  const [requests, setRequests] = useState<ReturnRequestRow[]>([]);
  const [itemId, setItemId] = useState("");
  const [reason, setReason] = useState("WRONG_ITEM");
  const [explanation, setExplanation] = useState("");
  const [resolution, setResolution] = useState<"REFUND" | "EXCHANGE">("REFUND");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/account/returns", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) { setError(data.error || "Qaytarılma məlumatları yüklənmədi."); return; }
    setEligible(data.eligibleItems || []);
    setRequests(data.requests || []);
  }
  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/account/returns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderItemId: itemId, reason, explanation, resolution }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sorğu yaradılmadı.");
      setMessage("Sorğu mağazaya göndərildi."); setExplanation(""); await load();
    } catch (reasonValue) { setError(reasonValue instanceof Error ? reasonValue.message : "Sorğu yaradılmadı."); }
    finally { setBusy(false); }
  }

  async function cancel(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/account/returns", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "cancel" }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Sorğu ləğv edilmədi."); await load();
    } catch (reasonValue) { setError(reasonValue instanceof Error ? reasonValue.message : "Sorğu ləğv edilmədi."); }
    finally { setBusy(false); }
  }

  const field = `mt-1.5 ${controlClass()}`;
  return <div className="space-y-6">
    <section className="rounded-card border border-line bg-white p-5 sm:p-6">
      <h2 className="font-display text-h3 text-fg">Qaytarılma və dəyişdirilmə sorğusu</h2>
      <p className="mt-2 text-sm leading-6 text-fg-secondary">Sorğu yalnız çatdırılmış sifarişlər üçün açılır. Məbləğ sifariş zamanı qeydə alınmış məhsul qiymətindən götürülür. Geri ödəniş xarici provayder qoşulmadığı üçün avtomatik icra edilmir.</p>
      {eligible.length ? <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid text-sm font-medium text-fg">Məhsul<select required value={itemId} onChange={event => setItemId(event.target.value)} className={field}><option value="">Məhsul seçin</option>{eligible.map(item => <option key={item.id} value={item.id}>{item.storeOrder.store.name} · {item.productName}{item.variantName ? ` · ${item.variantName}` : ""} · {item.quantity} ədəd · {Number(item.lineTotal).toFixed(2)} ₼</option>)}</select></label>
        <label className="grid text-sm font-medium text-fg">Səbəb<select value={reason} onChange={event => setReason(event.target.value)} className={field}>{Object.entries(reasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="grid text-sm font-medium text-fg">İstənilən həll<select value={resolution} onChange={event => setResolution(event.target.value as "REFUND" | "EXCHANGE")} className={field}><option value="REFUND">Geri ödəniş</option><option value="EXCHANGE">Dəyişdirilmə</option></select></label>
        <label className="grid text-sm font-medium text-fg sm:col-span-2">Əlavə izah (istəyə görə)<textarea maxLength={2000} rows={3} value={explanation} onChange={event => setExplanation(event.target.value)} className={field}/></label>
        <button disabled={busy || !itemId} className={`${buttonClass({size:"sm"})} sm:col-span-2 sm:justify-self-start`}>{busy ? "Göndərilir…" : "Sorğunu göndər"}</button>
      </form> : <p className="mt-4 rounded-control bg-surface-sunken px-4 py-3 text-sm text-fg-secondary">Qaytarılma üçün uyğun çatdırılmış məhsul yoxdur.</p>}
      {message && <p role="status" className="mt-3 rounded-control bg-primary-subtle px-3 py-2 text-sm font-medium text-primary">{message}</p>}{error && <p role="alert" className="mt-3 rounded-control bg-danger-subtle px-3 py-2 text-sm font-medium text-danger">{error}</p>}
    </section>
    <section><h2 className="font-display text-h3 text-fg">Sorğularım</h2><div className="mt-3 space-y-3">{requests.map(item => <article key={item.id} className="rounded-card border border-line bg-white p-5">
      <div className="flex flex-wrap justify-between gap-2"><div><h3 className="font-semibold text-fg">{item.orderItem.productName}{item.orderItem.variantName ? ` · ${item.orderItem.variantName}` : ""}</h3><p className="mt-1 text-sm text-fg-secondary">{item.storeOrder.store.name} · sifariş #{item.storeOrder.orderId.slice(-8).toUpperCase()}</p></div><Badge tone={returnStatusTone(item.status)} className="h-fit">{returnStatusLabel(item.status)}</Badge></div>
      <p className="mt-3 text-sm text-fg-secondary">{reasonLabels[item.reason] || item.reason} · {item.resolution === "REFUND" ? "Geri ödəniş" : "Dəyişdirilmə"}</p>
      <p className="mt-1 text-sm">Sifarişdə qeydə alınmış məbləğ: <b>{Number(item.refundAmount).toFixed(2)} ₼</b></p>
      {item.explanation && <p className="mt-2 text-sm text-fg-secondary">{item.explanation}</p>}{item.vendorResponse && <p className="mt-2 rounded-control bg-surface-sunken p-3 text-sm text-fg-body">Mağazanın cavabı: {item.vendorResponse}</p>}
      {item.status === "REQUESTED" && <button disabled={busy} onClick={() => void cancel(item.id)} className={`mt-3 ${buttonClass({variant:"secondary",size:"sm"})}`}>Sorğunu ləğv et</button>}
    </article>)}{!requests.length && <p className="rounded-card border border-dashed border-line-strong bg-white p-5 text-sm text-fg-secondary">Hələ qaytarılma sorğusu yoxdur.</p>}</div></section>
  </div>;
}
