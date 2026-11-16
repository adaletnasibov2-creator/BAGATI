"use client";
/**
 * Seller order page: the customer's open cancellation request (approve = store cancel, stock restored; reject = reason
 * for the customer). While it is open the order cannot be handed to the courier (enforced by the server).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CANCELLATION_RESPONSE_MAX, CANCELLATION_TEXT } from "@/lib/order-cancellation";

type Props = {
  storeId: string;
  request: { id: string; reason: string; createdAt: string } | null;
  paid: boolean;
  refundPending: boolean;
};

export default function VendorCancellationRequest({ storeId, request, paid, refundPending }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [response, setResponse] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function decide(decision: "APPROVE" | "REJECT") {
    if (!request) return;
    if (decision === "APPROVE" && !window.confirm("Sifarişi ləğv edirsiniz? Məhsullar stoka qaytarılacaq. Bu addım geri alınmır.")) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await fetch(`/api/vendor/${encodeURIComponent(storeId)}/cancellation-requests/${encodeURIComponent(request.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, response: response.trim() || null }),
      });
      const data = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(typeof data.error === "string" ? data.error : "Qərar saxlanmadı.");
      setMessage({ ok: true, text: decision === "APPROVE" ? "Sifariş ləğv edildi." : "Müraciət rədd edildi; sifariş davam edir." });
      router.refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Qərar saxlanmadı." });
    } finally {
      setBusy(false);
    }
  }

  if (!request && !refundPending) return null;
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:p-6" data-vendor-cancellation>
      {refundPending && !request && (
        <p className="text-sm font-semibold text-amber-950">{CANCELLATION_TEXT.refundPending}: sifariş ləğv edilib, ödəniş isə alınıb. Geri ödənişi əl ilə edin.</p>
      )}
      {request && (
        <>
          <h2 className="font-semibold text-amber-950">Müştəri sifarişin ləğvini istəyir</h2>
          <p className="mt-2 text-sm text-amber-950">Səbəb: {request.reason}</p>
          <p className="mt-1 text-xs text-amber-900">{new Date(request.createdAt).toLocaleString("az-AZ")}</p>
          <p className="mt-3 text-sm text-amber-900">Müraciət açıq olduğu müddətdə sifariş kuryerə verilə bilməz.{paid ? " Ödəniş alınıb: təsdiqləsəniz, geri ödəniş əl ilə edilir." : ""}</p>
          {message && <p role={message.ok ? "status" : "alert"} className={`mt-3 rounded-xl px-3 py-2 text-sm ${message.ok ? "bg-white text-[#21573f]" : "bg-red-50 text-red-800"}`}>{message.text}</p>}
          {rejecting ? (
            <form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); void decide("REJECT"); }}>
              <label className="grid gap-1 text-sm font-medium text-amber-950">
                Müştəriyə cavab (rədd etmə səbəbi)
                <textarea required maxLength={CANCELLATION_RESPONSE_MAX} rows={3} value={response} onChange={(event) => setResponse(event.target.value)} className="rounded-xl border border-amber-200 bg-white px-3 py-2 font-normal" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy || !response.trim()} className="min-h-11 rounded-xl bg-[#173c40] px-4 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Saxlanır…" : "Rədd et"}</button>
                <button type="button" disabled={busy} onClick={() => setRejecting(false)} className="min-h-11 rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold">İmtina</button>
              </div>
            </form>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void decide("APPROVE")} className="min-h-11 rounded-xl bg-[#173c40] px-4 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Saxlanır…" : "Təsdiqlə və ləğv et"}</button>
              <button type="button" disabled={busy} onClick={() => setRejecting(true)} className="min-h-11 rounded-xl border border-amber-300 bg-white px-4 text-sm font-semibold">Rədd et</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
