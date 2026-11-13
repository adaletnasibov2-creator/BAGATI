"use client";

import { useState } from "react";
import { Download } from "lucide-react";

type Props = { filters: Record<string, string>; maxRows: number };

/** Locale-independent ("10 000") so server and browser render the same text; toLocaleString differs between Node ICU and browsers and broke hydration. */
export function formatRowLimit(value: number) {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** POSTs the active filters (same-origin fetch, so the shared cross-site check passes) and downloads the CSV. */
export default function AdminAuditExportButton({ filters, maxRows }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function exportCsv() {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/audit-log/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "İxrac alınmadı.");
      }
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "bagati-audit-log.csv";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      const rows = response.headers.get("x-export-row-count") ?? "?";
      setMessage(response.headers.get("x-export-truncated") === "1"
        ? `${rows} sətir ixrac edildi (limit). Daha çoxu üçün filtrləri daraldın.`
        : `${rows} sətir ixrac edildi.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "İxrac alınmadı.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid justify-items-end gap-1">
    <button type="button" onClick={() => void exportCsv()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-[#c7ad78] bg-white px-4 py-2.5 text-sm font-semibold text-[#85621d] disabled:opacity-60">
      <Download size={16} aria-hidden="true" />
      {busy ? "Hazırlanır…" : `CSV ixrac (maks. ${formatRowLimit(maxRows)} sətir)`}
    </button>
    {message && <p role="status" className="text-xs text-emerald-800">{message}</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </div>;
}
