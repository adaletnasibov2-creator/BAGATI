"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** REVIEWED / DISMISSED buttons for an OPEN messaging report (POST /api/admin/messages/reports/[id], audited). */
export function AdminReportDecision({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(status: "REVIEWED" | "DISMISSED") {
    setBusy(true); setError("");
    const response = await fetch(`/api/admin/messages/reports/${encodeURIComponent(reportId)}`, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const data = await response?.json().catch(() => null) as { error?: string } | null;
      setError(data?.error ?? "Əməliyyat alınmadı.");
      return;
    }
    router.refresh();
  }
  return <div className="flex flex-wrap items-center gap-2">
    <button type="button" disabled={busy} onClick={() => void decide("REVIEWED")} className="rounded-lg bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">Baxıldı</button>
    <button type="button" disabled={busy} onClick={() => void decide("DISMISSED")} className="rounded-lg border border-[#ded9cf] bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-60">Rədd et</button>
    {error && <p role="alert" className="w-full text-sm text-red-700">{error}</p>}
  </div>;
}
