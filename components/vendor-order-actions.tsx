"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { allowedVendorOrderTransitions, statusLabel } from "@/lib/order-status";
import { allowedShipmentTransitions, shipmentStatusLabel, type ShipmentStatusValue } from "@/lib/shipment-tracking";

type Props = {
  storeId: string;
  storeOrderId: string;
  status: string;
  shipmentStatus: ShipmentStatusValue | null;
  trackingUrl: string | null;
  deliveryMethod: string | null;
  deliveryNote: string | null;
  deliveryCarrier: string | null;
  deliveryTrackingCode: string | null;
};

export default function VendorOrderActions(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const transitions = allowedVendorOrderTransitions(props.status);
  const shipmentTransitions = allowedShipmentTransitions(props.shipmentStatus).filter(value => value !== "DELIVERED" || ["HANDED_TO_COURIER", "SHIPPED"].includes(props.status));

  async function save(event: FormEvent<HTMLFormElement>, mode: "order" | "delivery" | "shipment") {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const body: Record<string, string | null> = { id: props.storeOrderId };
    if (mode === "delivery") {
      for (const field of ["deliveryMethod", "deliveryNote", "deliveryCarrier", "deliveryTrackingCode"]) {
        const value = String(form.get(field) || "").trim();
        body[field] = value || null;
      }
      const trackingUrl = String(form.get("trackingUrl") || "").trim();
      body.trackingUrl = trackingUrl || null;
    } else if (mode === "shipment") {
      body.shipmentStatus = String(form.get("shipmentStatus") || "");
    } else {
      body.status = String(form.get("status") || "");
    }
    try {
      const response = await fetch(`/api/vendor/${encodeURIComponent(props.storeId)}/orders`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Məlumatı yeniləmək mümkün olmadı.");
      setMessage(result.warning || "Məlumat uğurla yadda saxlanıldı.");
      router.refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Məlumatı yeniləmək mümkün olmadı.");
    } finally {
      setBusy(false);
    }
  }

  const input = "min-h-11 w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#b99a5b]";
  return <section className="space-y-5 rounded-2xl border border-[#e9e4da] bg-white p-5 sm:p-6">
    <div><p className="text-xs font-semibold uppercase tracking-[.15em] text-[#967844]">Sifariş əməliyyatları</p><h2 className="mt-1 text-lg font-semibold text-[#142d38]">Status və çatdırılma</h2></div>
    {transitions.length > 0 && <form onSubmit={event => void save(event, "order")} className="grid gap-3 sm:grid-cols-[1fr_auto]">
      <label className="grid gap-1 text-sm text-slate-600">Növbəti status<select name="status" required className={input} defaultValue=""><option value="" disabled>Status seçin</option>{transitions.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
      <button disabled={busy} className="self-end rounded-xl bg-[#173c40] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">Statusu yenilə</button>
    </form>}
    <form onSubmit={event => void save(event, "delivery")} className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm text-slate-600">Çatdırılma üsulu<input name="deliveryMethod" defaultValue={props.deliveryMethod || ""} placeholder="Məsələn, mağazanın kuryeri" className={input}/></label>
      <label className="grid gap-1 text-sm text-slate-600">Daşıyıcı<input name="deliveryCarrier" defaultValue={props.deliveryCarrier || ""} className={input}/></label>
      <label className="grid gap-1 text-sm text-slate-600">İzləmə kodu<input name="deliveryTrackingCode" defaultValue={props.deliveryTrackingCode || ""} className={input}/></label>
      <label className="grid gap-1 text-sm text-slate-600 sm:col-span-2">İzləmə linki (HTTPS)<input name="trackingUrl" type="url" defaultValue={props.trackingUrl || ""} placeholder="https://..." className={input}/></label>
      <label className="grid gap-1 text-sm text-slate-600">Çatdırılma qeydi<input name="deliveryNote" defaultValue={props.deliveryNote || ""} className={input}/></label>
      <button disabled={busy} className="rounded-xl border border-[#d9d4c9] px-4 py-3 text-sm font-semibold text-[#173c40] hover:bg-[#f8f7f4] disabled:opacity-50 sm:col-span-2">Çatdırılma məlumatını yadda saxla</button>
    </form>
    <form onSubmit={event => void save(event, "shipment")} className="grid gap-3 border-t border-[#eeeae2] pt-4 sm:grid-cols-[1fr_auto]">
      <label className="grid gap-1 text-sm text-slate-600">Göndəriş statusu<select name="shipmentStatus" required className={input} defaultValue=""><option value="" disabled>{props.shipmentStatus ? shipmentStatusLabel(props.shipmentStatus) : "Başlanğıc statusu seçin"}</option>{shipmentTransitions.map(value => <option key={value} value={value}>{shipmentStatusLabel(value)}</option>)}</select></label>
      <button disabled={busy || !shipmentTransitions.length} className="self-end rounded-xl bg-[#173c40] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">Göndəriş statusunu yenilə</button>
      <p className="text-xs leading-5 text-slate-500 sm:col-span-2">Daşıyıcı API inteqrasiyası qoşulmayıb. Status yalnız mağaza tərəfindən təsdiqlənmiş məlumat əsasında yenilənir.</p>
    </form>
    {message && <p role="status" className="rounded-xl bg-[#f3f7f4] p-3 text-sm text-[#28766f]">{message}</p>}
  </section>;
}
