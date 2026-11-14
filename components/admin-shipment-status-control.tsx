"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ResultMessage } from "@/components/admin-ui/result-message";
import { buttonClass, inputClass } from "@/components/admin-ui/styles";
import { allowedShipmentTransitions, shipmentChangeAllowedForOrder, shipmentStatusLabel, type ShipmentStatusValue } from "@/lib/shipment-tracking";

/** Admin shipment status for one store order (audited on the server). Does not change the order or payment status. */
export function AdminShipmentStatusControl({ storeOrderId, shipmentStatus, orderStatus }: { storeOrderId: string; shipmentStatus: ShipmentStatusValue | null; orderStatus: string }) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const options = shipmentChangeAllowedForOrder(orderStatus) ? allowedShipmentTransitions(shipmentStatus) : [];

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || busy) return;
    setBusy(true); setResult(null);
    try {
      const response = await fetch(`/api/admin/store-orders/${encodeURIComponent(storeOrderId)}/shipment`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shipmentStatus: target }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "Yadda saxlamaq alınmadı.");
      setResult({ tone: "success", text: json.message || "Göndəriş statusu yeniləndi." });
      setTarget("");
      router.refresh();
    } catch (error) {
      setResult({ tone: "error", text: error instanceof Error ? error.message : "Yadda saxlamaq alınmadı." });
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={save} className="mt-3 grid gap-2 rounded-xl bg-[#f8f7f4] p-3 sm:grid-cols-[1fr_auto] sm:items-end">
    <label className="grid gap-1 text-sm text-slate-700">
      <span>Göndəriş statusu: <b>{shipmentStatus ? shipmentStatusLabel(shipmentStatus) : "Başlanmayıb"}</b></span>
      <select value={target} onChange={(event) => setTarget(event.target.value)} disabled={!options.length || busy} className={inputClass}>
        <option value="">{options.length ? "Növbəti statusu seçin" : "Dəyişiklik mümkün deyil"}</option>
        {options.map((value) => <option key={value} value={value}>{shipmentStatusLabel(value)}</option>)}
      </select>
    </label>
    <button type="submit" disabled={!target || busy} className={buttonClass("secondary")}>{busy ? "Gözləyin…" : "Göndəriş statusunu saxla"}</button>
    <p className="text-xs text-slate-500 sm:col-span-2">Audit jurnalına yazılır. Sifariş və ödəniş statusu dəyişmir; alıcıya e-poçt göndərilmir.</p>
    {result && <div className="sm:col-span-2"><ResultMessage tone={result.tone}>{result.text}</ResultMessage></div>}
  </form>;
}
