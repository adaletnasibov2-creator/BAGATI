"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** "Mark as read" for one message, or for every new message of the store. */
export default function VendorInquiryReadButton({ storeId, inquiryId, label }: { storeId: string; inquiryId?: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function markRead() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/vendor/${encodeURIComponent(storeId)}/inquiries`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inquiryId ? { id: inquiryId } : { all: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Yenilənmədi.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Yenilənmədi.");
    } finally {
      setBusy(false);
    }
  }
  return <span className="inline-flex flex-col items-start gap-1">
    <button type="button" onClick={() => void markRead()} disabled={busy} className="min-h-10 rounded-xl border border-[#ded9cf] bg-white px-3 text-sm font-medium text-[#173c40] hover:border-[#b89758] disabled:opacity-50">{busy ? "Gözləyin…" : label}</button>
    {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
  </span>;
}
