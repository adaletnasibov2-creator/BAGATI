"use client";
/**
 * Customer order page: cancel the order (rule 1), ask a store to cancel its part (rule 2), or the reason why neither is
 * possible (rule 3). The server decides which state applies (lib/order-cancellation.ts) and re-checks it on every action.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CANCELLATION_REASON_MAX, CANCELLATION_TEXT, type StoreOrderCancellationState } from "@/lib/order-cancellation";

export type CancelPanelStoreOrder = {
  id: string;
  storeName: string;
  state: StoreOrderCancellationState;
  openRequestId: string | null;
  lastRequestRejected: boolean;
  rejectResponse: string | null;
  refundPending: boolean;
};

const box = "rounded-2xl border border-line bg-white p-5";
const primary = "inline-flex min-h-11 items-center justify-center rounded-xl bg-ink px-4 text-sm font-semibold text-white disabled:opacity-60";
const secondary = "inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-white px-4 text-sm font-semibold text-ink disabled:opacity-60";

async function send(url: string, method: string, body: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Əməliyyat tamamlana bilmədi.");
  return data;
}

export function OrderCancelActions({ orderId, direct, storeOrders }: { orderId: string; direct: boolean; storeOrders: CancelPanelStoreOrder[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [requestFor, setRequestFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const multiStore = storeOrders.length > 1;

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ ok: true, text: success });
      setConfirming(false);
      setRequestFor(null);
      setReason("");
      router.refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Əməliyyat tamamlana bilmədi." });
    } finally {
      setBusy(false);
    }
  }

  const visible = direct || storeOrders.some((row) => row.state !== "CLOSED" || row.refundPending);
  if (!visible && !message) return null;

  return (
    <section className={box} aria-labelledby="order-cancel-title" data-order-cancel>
      <h2 id="order-cancel-title" className="font-semibold">Sifarişin ləğvi</h2>
      {message && <p role={message.ok ? "status" : "alert"} className={`mt-3 rounded-xl px-3 py-2 text-sm ${message.ok ? "bg-[#edf5f0] text-[#21573f]" : "bg-red-50 text-red-800"}`}>{message.text}</p>}

      {direct ? (
        <div className="mt-3" data-cancel-state="DIRECT">
          <p className="text-sm text-muted">Mağaza sifarişi hələ təsdiqləməyib. Sifarişi indi ləğv edə bilərsiniz; məhsullar stoka qaytarılacaq.</p>
          {confirming ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-950">Bütün sifarişi ləğv etmək istədiyinizə əminsiniz? Bu əməliyyat geri qaytarılmır.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy} className={primary} onClick={() => run(() => send(`/api/orders/${encodeURIComponent(orderId)}/cancel`, "POST", {}), "Sifariş ləğv edildi.")}>
                  {busy ? "Ləğv edilir…" : "Bəli, ləğv et"}
                </button>
                <button type="button" disabled={busy} className={secondary} onClick={() => setConfirming(false)}>İmtina</button>
              </div>
            </div>
          ) : (
            <button type="button" className={`${secondary} mt-3`} onClick={() => setConfirming(true)}>Sifarişi ləğv et</button>
          )}
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {storeOrders.map((row) => (
            <li key={row.id} data-cancel-state={row.state} className="text-sm">
              {multiStore && <p className="font-medium">{row.storeName}</p>}
              {row.refundPending && <p className="mt-1 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">{CANCELLATION_TEXT.refundPending}</p>}
              {row.state === "IN_TRANSIT" && <p className="mt-1 text-muted">{CANCELLATION_TEXT.inTransit}</p>}
              {row.state === "DELIVERED" && <p className="mt-1 text-muted">{CANCELLATION_TEXT.delivered} <Link href="/account/returns" className="font-medium text-emerald underline">Qaytarma müraciəti</Link></p>}
              {row.state === "REQUESTED" && (
                <div className="mt-1">
                  <p className="text-muted">{CANCELLATION_TEXT.requested}</p>
                  {row.openRequestId && (
                    <button type="button" disabled={busy} className={`${secondary} mt-2`} onClick={() => run(() => send(`/api/orders/${encodeURIComponent(orderId)}/cancellation-requests/${encodeURIComponent(row.openRequestId!)}`, "PATCH", { action: "withdraw" }), "Ləğv müraciəti geri götürüldü.")}>
                      Müraciəti geri götür
                    </button>
                  )}
                </div>
              )}
              {row.state === "REQUEST" && (
                <div className="mt-1">
                  {row.lastRequestRejected && <p className="text-muted">{CANCELLATION_TEXT.rejected}{row.rejectResponse ? ` Mağazanın cavabı: ${row.rejectResponse}` : ""}</p>}
                  <p className="text-muted">Mağaza sifarişi təsdiqləyib və ya ödəniş edilib. Ləğv üçün mağazaya müraciət göndərin; qərarı mağaza verir.</p>
                  {requestFor === row.id ? (
                    <form className="mt-2 grid gap-2" onSubmit={(event) => { event.preventDefault(); void run(() => send(`/api/orders/${encodeURIComponent(orderId)}/cancellation-requests`, "POST", { storeOrderId: row.id, reason }), "Ləğv müraciəti mağazaya göndərildi."); }}>
                      <label className="grid gap-1 text-sm font-medium">
                        Ləğv səbəbi
                        <textarea required minLength={3} maxLength={CANCELLATION_REASON_MAX} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} className="rounded-xl border border-line px-3 py-2 font-normal" placeholder="Məsələn: fikrimi dəyişdim, yanlış məhsul seçmişəm" />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button type="submit" disabled={busy || reason.trim().length < 3} className={primary}>{busy ? "Göndərilir…" : "Müraciəti göndər"}</button>
                        <button type="button" disabled={busy} className={secondary} onClick={() => { setRequestFor(null); setReason(""); }}>İmtina</button>
                      </div>
                    </form>
                  ) : (
                    <button type="button" className={`${secondary} mt-2`} onClick={() => { setRequestFor(row.id); setMessage(null); }}>Ləğv müraciəti göndər</button>
                  )}
                </div>
              )}
              {row.state === "CLOSED" && !row.refundPending && multiStore && <p className="mt-1 text-muted">Bu hissə bağlanıb.</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
