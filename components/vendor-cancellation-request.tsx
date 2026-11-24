"use client";
/**
 * Seller order page: the customer's open cancellation request (approve = store cancel, stock restored; reject = reason
 * for the customer). While it is open the order cannot be handed to the courier (enforced by the server).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CANCELLATION_RESPONSE_MAX, CANCELLATION_TEXT } from "@/lib/order-cancellation";
import { AlertTriangle } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { formatOrderDateTime } from "@/lib/vendor-order-view";

type Props = {
  storeId: string;
  request: { id: string; reason: string; createdAt: string; createdAtText?: string } | null;
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
    <section role="region" aria-labelledby="vendor-cancellation-title" className="flex gap-3 rounded-card border border-gold-200 bg-[#fbf6ec] p-5 shadow-[inset_4px_0_0_var(--bagati-gold-400)] sm:gap-4 sm:p-6" data-vendor-cancellation>
      <AlertTriangle aria-hidden="true" size={22} strokeWidth={2} className="mt-0.5 shrink-0 text-gold-700"/>
      <div className="min-w-0 flex-1">
      {refundPending && !request && (
        <p id="vendor-cancellation-title" className="text-sm font-semibold text-fg">{CANCELLATION_TEXT.refundPending}: sifariş ləğv edilib, ödəniş isə alınıb. Geri ödənişi əl ilə edin.</p>
      )}
      {request && (
        <>
          <h2 id="vendor-cancellation-title" className="text-base font-semibold text-fg">Müştəri sifarişin ləğvini istəyir</h2>
          <p className="mt-2 break-words text-sm text-fg-body">Səbəb: {request.reason}</p>
          <p className="mt-1 text-xs tabular-nums text-fg-secondary">{request.createdAtText ?? formatOrderDateTime(request.createdAt)}</p>
          <p className="mt-3 text-sm text-gold-700">Müraciət açıq olduğu müddətdə sifariş kuryerə verilə bilməz.{paid ? " Ödəniş alınıb: təsdiqləsəniz, geri ödəniş əl ilə edilir." : ""}</p>
          {message && <p role={message.ok ? "status" : "alert"} className={`mt-3 rounded-xl px-3 py-2 text-sm ${message.ok ? "bg-white text-[#21573f]" : "bg-red-50 text-red-800"}`}>{message.text}</p>}
          {rejecting ? (
            <form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); void decide("REJECT"); }}>
              <label className="grid gap-1 text-sm font-medium text-fg">
                Müştəriyə cavab (rədd etmə səbəbi)
                <textarea required maxLength={CANCELLATION_RESPONSE_MAX} rows={3} value={response} onChange={(event) => setResponse(event.target.value)} className="rounded-control border border-line-strong bg-white px-3 py-2 font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy || !response.trim()} className={buttonClass({ size: "sm" })}>{busy ? "Saxlanır…" : "Rədd et"}</button>
                <button type="button" disabled={busy} onClick={() => setRejecting(false)} className={buttonClass({ variant: "secondary", size: "sm" })}>İmtina</button>
              </div>
            </form>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void decide("APPROVE")} className={buttonClass({ variant: "danger", size: "sm" })}>{busy ? "Saxlanır…" : "Təsdiqlə və ləğv et"}</button>
              <button type="button" disabled={busy} onClick={() => setRejecting(true)} className={buttonClass({ variant: "secondary", size: "sm" })}>Rədd et</button>
            </div>
          )}
        </>
      )}
      </div>
    </section>
  );
}
