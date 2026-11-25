"use client";
/**
 * ORDER-NOTIFY-1: "Təhvil aldım" for one store order on the customer's order page. The server decides `allowed`
 * (lib/order-receipt.ts receiptAllowed) and re-checks it on the POST. After a confirmation the confirmed state shows
 * the stored time (Baku, the site's deterministic date helper) and the page refreshes. No optimistic UI.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, PackageCheck } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { ORDER_NOTIFY_TEXT } from "@/lib/order-notify-text";
import { formatOrderDateTime } from "@/lib/vendor-order-view";

export function OrderReceiptButton({ orderId, storeOrderId, allowed, confirmedAt }: { orderId: string; storeOrderId: string; allowed: boolean; confirmedAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState<string | null>(confirmedAt);

  if (confirmed) {
    return <p data-order-receipt="confirmed" role="status" className="flex items-start gap-2 text-sm font-medium text-primary">
      <CheckCircle2 aria-hidden="true" size={18} strokeWidth={2} className="mt-0.5 shrink-0"/>
      <span>{ORDER_NOTIFY_TEXT.receiptConfirmed} <time dateTime={confirmed} className="tabular-nums">{formatOrderDateTime(confirmed)}</time></span>
    </p>;
  }
  if (!allowed) return null;

  async function confirm() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/store-orders/${encodeURIComponent(storeOrderId)}/receipt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.confirmedAt !== "string") { setError(typeof data.error === "string" ? data.error : "Əməliyyat uğursuz oldu."); return; }
      setConfirmed(data.confirmedAt);
      router.refresh();
    } catch {
      setError("Əməliyyat uğursuz oldu.");
    } finally {
      setBusy(false);
    }
  }

  return <div data-order-receipt="open" className="grid gap-2 sm:justify-items-start">
    <button type="button" onClick={() => void confirm()} disabled={busy} aria-busy={busy} className={cx(buttonClass({ size: "sm" }), "min-h-11 w-full sm:w-auto")}>
      <PackageCheck aria-hidden="true" size={16} strokeWidth={2}/>{ORDER_NOTIFY_TEXT.receiptButton}
    </button>
    {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
  </div>;
}
