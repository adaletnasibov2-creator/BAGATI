"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { allowedVendorOrderTransitions, statusLabel } from "@/lib/order-status";
import { allowedShipmentTransitions, nextSimpleShipmentStatus, shipmentChangeAllowedForOrder, shipmentStatusLabel, simpleShipmentStep, SIMPLE_SHIPMENT_STEPS, type ShipmentStatusValue } from "@/lib/shipment-tracking";

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
  // The shipment status is independent of the order status: it only tells the customer how the delivery is going.
  const shipmentOpen = shipmentChangeAllowedForOrder(props.status);
  const shipmentTransitions = shipmentOpen ? allowedShipmentTransitions(props.shipmentStatus) : [];
  const nextStep = shipmentOpen ? nextSimpleShipmentStatus(props.shipmentStatus) : null;
  const currentStep = simpleShipmentStep(props.shipmentStatus);

  async function setShipment(value: ShipmentStatusValue) {
    if (value === "DELIVERED" && !window.confirm("Göndərişi çatdırılmış kimi qeyd edirsiniz? Bu addım geri alınmır. Sifariş və ödəniş statusu dəyişmir.")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/vendor/${encodeURIComponent(props.storeId)}/orders`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: props.storeOrderId, shipmentStatus: value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Məlumatı yeniləmək mümkün olmadı.");
      setMessage(result.warning || "Çatdırılma statusu yeniləndi.");
      router.refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Məlumatı yeniləmək mümkün olmadı.");
    } finally {
      setBusy(false);
    }
  }

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
      const confirmations: Record<string, string> = {
        CANCELLED: "Sifarişi ləğv etmək istədiyinizə əminsiniz? Alıcıya bildiriş göndəriləcək və məhsullar anbara geri qaytarılacaq. Bu addımı geri almaq olmur.",
        RETURNED: "Sifarişi qaytarılmış kimi qeyd etmək istədiyinizə əminsiniz? Bu addımı geri almaq olmur.",
      };
      if (confirmations[body.status] && !window.confirm(confirmations[body.status])) { setBusy(false); return; }
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
    <div data-simple-shipment className="rounded-xl bg-[#f8f7f4] p-4">
      <p className="text-sm font-semibold text-[#142d38]">Çatdırılma statusu</p>
      <ol className="mt-3 grid grid-cols-3 gap-2">
        {SIMPLE_SHIPMENT_STEPS.map((step, index) => {
          const done = index <= currentStep;
          const isNext = step.status === nextStep;
          return <li key={step.status}>
            <button type="button" disabled={busy || !isNext} aria-current={index === currentStep ? "step" : undefined} onClick={() => void setShipment(step.status)}
              className={`min-h-12 w-full rounded-xl px-2 text-sm font-semibold transition ${done ? "bg-[#e3eee8] text-[#28766f]" : isNext ? "bg-[#173c40] text-white hover:bg-[#28766f]" : "border border-[#e3ded4] bg-white text-slate-400"} disabled:cursor-default ${isNext ? "disabled:opacity-60" : ""}`}>
              {done ? "✓ " : ""}{step.label}
            </button>
          </li>;
        })}
      </ol>
      <p className="mt-2 text-xs leading-5 text-slate-500">{shipmentOpen
        ? "Alıcı bu statusu sifarişində görür. Sifariş və ödəniş statusu ayrıca idarə olunur və bundan dəyişmir."
        : "Ləğv edilmiş və ya qaytarılmış sifariş üçün çatdırılma statusu dəyişdirilmir."}</p>
    </div>
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
    <details className="border-t border-[#eeeae2] pt-4"><summary className="cursor-pointer text-sm font-medium text-[#173c40]">Ətraflı göndəriş statusu</summary>
    <form onSubmit={event => void save(event, "shipment")} className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
      <label className="grid gap-1 text-sm text-slate-600">Göndəriş statusu<select name="shipmentStatus" required className={input} defaultValue=""><option value="" disabled>{props.shipmentStatus ? shipmentStatusLabel(props.shipmentStatus) : "Başlanğıc statusu seçin"}</option>{shipmentTransitions.map(value => <option key={value} value={value}>{shipmentStatusLabel(value)}</option>)}</select></label>
      <button disabled={busy || !shipmentTransitions.length} className="self-end rounded-xl bg-[#173c40] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">Göndəriş statusunu yenilə</button>
      <p className="text-xs leading-5 text-slate-500 sm:col-span-2">Daşıyıcı API inteqrasiyası qoşulmayıb. Status yalnız mağaza tərəfindən təsdiqlənmiş məlumat əsasında yenilənir.</p>
    </form></details>
    {message && <p role="status" className="rounded-xl bg-[#f3f7f4] p-3 text-sm text-[#28766f]">{message}</p>}
  </section>;
}
