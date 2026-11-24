"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { allowedVendorOrderTransitions, statusLabel } from "@/lib/order-status";
import { allowedShipmentTransitions, nextSimpleShipmentStatus, shipmentChangeAllowedForOrder, shipmentStatusLabel, simpleShipmentStep, SIMPLE_SHIPMENT_STEPS, type ShipmentStatusValue } from "@/lib/shipment-tracking";
import { ArrowRight } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { cx, focusRing } from "@/components/ui/cx";
import { vendorInput } from "@/components/vendor-form";
import { destructiveLabel, splitTransitions } from "@/lib/vendor-order-view";

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
    // SELLER-ORDERS-DESIGN-1: the order status comes from the clicked button (one button per allowed transition).
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (mode === "order" && submitter?.name === "status") form.set("status", submitter.value);
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

  const input = vendorInput;
  const { forward, destructive } = splitTransitions(transitions);
  const dangerButton = cx("inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-full border border-danger bg-white px-4 text-sm font-semibold text-danger transition-colors hover:bg-danger-subtle disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none", focusRing);
  return <section className="min-w-0 space-y-5 rounded-card border border-line bg-white p-5 sm:p-6" data-vendor-order-actions="">
    <div><p className="text-kicker uppercase text-gold-700">Sifariş əməliyyatları</p><h2 className="mt-1 font-display text-h3 text-fg">Status və çatdırılma</h2></div>
    {forward.length > 0 && <form onSubmit={event => void save(event, "order")} className="grid gap-2" data-order-next-status="">
      <p className="text-sm font-semibold text-fg">Növbəti status</p>
      <div className="grid gap-2">{forward.map(value => <button key={value} type="submit" name="status" value={value} disabled={busy} className={buttonClass({ size: "md", fullWidth: true })}>{statusLabel(value)}<ArrowRight aria-hidden="true" size={18} strokeWidth={2}/></button>)}</div>
    </form>}
    <div data-simple-shipment className="rounded-control bg-surface-page p-4">
      <p className="text-sm font-semibold text-fg">Çatdırılma statusu</p>
      <ol className="mt-3 grid grid-cols-3 gap-2">
        {SIMPLE_SHIPMENT_STEPS.map((step, index) => {
          const done = index <= currentStep;
          const isNext = step.status === nextStep;
          return <li key={step.status}>
            <button type="button" disabled={busy || !isNext} aria-current={index === currentStep ? "step" : undefined} onClick={() => void setShipment(step.status)}
              className={cx("min-h-12 w-full rounded-control px-2 text-sm font-semibold transition-colors motion-reduce:transition-none disabled:cursor-default", focusRing, done ? "bg-primary-tint text-primary" : isNext ? "border border-primary bg-white text-primary hover:bg-primary-subtle disabled:opacity-60" : "border border-line bg-white text-fg-muted")}>
              {done ? "✓ " : ""}{step.label}
            </button>
          </li>;
        })}
      </ol>
      <p className="mt-2 text-xs leading-5 text-fg-muted">{shipmentOpen
        ? "Alıcı bu statusu sifarişində görür. Sifariş və ödəniş statusu ayrıca idarə olunur və bundan dəyişmir."
        : "Ləğv edilmiş və ya qaytarılmış sifariş üçün çatdırılma statusu dəyişdirilmir."}</p>
    </div>
    <form onSubmit={event => void save(event, "delivery")} className="grid gap-3 border-t border-line pt-5">
      <p className="text-sm font-semibold text-fg">Çatdırılma məlumatları</p>
      <label className="grid gap-1 text-sm text-fg-secondary">Çatdırılma üsulu<input name="deliveryMethod" defaultValue={props.deliveryMethod || ""} placeholder="Məsələn, mağazanın kuryeri" className={input}/></label>
      <div className="grid gap-3 min-[480px]:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <label className="grid min-w-0 gap-1 text-sm text-fg-secondary">Daşıyıcı<input name="deliveryCarrier" defaultValue={props.deliveryCarrier || ""} className={input}/></label>
        <label className="grid min-w-0 gap-1 text-sm text-fg-secondary">İzləmə kodu<input name="deliveryTrackingCode" defaultValue={props.deliveryTrackingCode || ""} className={input}/></label>
      </div>
      <label className="grid gap-1 text-sm text-fg-secondary">İzləmə linki (HTTPS)<input name="trackingUrl" type="url" defaultValue={props.trackingUrl || ""} placeholder="https://..." className={input}/></label>
      <label className="grid gap-1 text-sm text-fg-secondary">Çatdırılma qeydi<input name="deliveryNote" defaultValue={props.deliveryNote || ""} className={input}/></label>
      <button disabled={busy} className={buttonClass({ variant: "secondary", size: "sm" })}>Çatdırılma məlumatını yadda saxla</button>
    </form>
    <details className="border-t border-line pt-4"><summary className={cx("cursor-pointer rounded-control text-sm font-medium text-primary", focusRing)}>Ətraflı göndəriş statusu</summary>
    <form onSubmit={event => void save(event, "shipment")} className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
      <label className="grid gap-1 text-sm text-fg-secondary">Göndəriş statusu<select name="shipmentStatus" required className={input} defaultValue=""><option value="" disabled>{props.shipmentStatus ? shipmentStatusLabel(props.shipmentStatus) : "Başlanğıc statusu seçin"}</option>{shipmentTransitions.map(value => <option key={value} value={value}>{shipmentStatusLabel(value)}</option>)}</select></label>
      <button disabled={busy || !shipmentTransitions.length} className={`self-end ${buttonClass({ size: "sm" })}`}>Göndəriş statusunu yenilə</button>
      <p className="text-xs leading-5 text-fg-muted sm:col-span-2">Daşıyıcı API inteqrasiyası qoşulmayıb. Status yalnız mağaza tərəfindən təsdiqlənmiş məlumat əsasında yenilənir.</p>
    </form></details>
    {destructive.length > 0 && <form onSubmit={event => void save(event, "order")} className="flex flex-wrap gap-2 border-t border-line pt-4" data-order-destructive="">
      {destructive.map(value => <button key={value} type="submit" name="status" value={value} disabled={busy} className={dangerButton}>{destructiveLabel(value)}</button>)}
    </form>}
    {message && <p role="status" className="rounded-control bg-primary-subtle p-3 text-sm text-primary">{message}</p>}
  </section>;
}
