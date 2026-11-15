"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink } from "lucide-react";
import { ResultMessage } from "@/components/admin-ui/result-message";
import { buttonClass, inputClass } from "@/components/admin-ui/styles";
import { VOEN_LOOKUP_URL } from "@/lib/voen";

export type VoenBulkRow = {
  userId: string; displayName: string; email: string; digits: string; formatValid: boolean; kindLabel: string | null;
  verified: boolean; duplicate: boolean; stores: number; storeNames: string | null; storeHref: string | null;
};

/**
 * Bulk VÖEN check for existing sellers: per row copy + "e-taxes-də yoxla", tick the ones checked on the official
 * search, one short note, "Seçilənləri təsdiqlə". Rows with an invalid format or a VÖEN shared with another seller
 * cannot be selected (they need the seller or the admin to fix the VÖEN first).
 */
export function AdminVoenBulk({ rows }: { rows: VoenBulkRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const selectable = rows.filter((row) => !row.verified && row.formatValid && !row.duplicate);

  function toggle(userId: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(userId)) next.delete(userId); else next.add(userId); return next; });
  }

  async function copy(digits: string) {
    try { await navigator.clipboard.writeText(digits); setCopied(digits); window.setTimeout(() => setCopied(null), 2000); } catch { setCopied(null); }
  }

  async function verifySelected() {
    if (busy || !selected.size || note.trim().length < 3) return;
    setBusy(true); setResult(null);
    const items = rows.filter((row) => selected.has(row.userId)).map((row) => ({ userId: row.userId, voen: row.digits }));
    try {
      const response = await fetch("/api/admin/voen-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify-many", items, note }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "Yadda saxlamaq alınmadı.");
      setResult({ tone: "success", text: json.message || "Təsdiqləndi." });
      setSelected(new Set()); setNote("");
      router.refresh();
    } catch (error) {
      setResult({ tone: "error", text: error instanceof Error ? error.message : "Yadda saxlamaq alınmadı." });
    } finally {
      setBusy(false);
    }
  }

  return <div className="grid gap-4">
    <div className="overflow-hidden rounded-2xl border border-[#e7e3d9] bg-white">
      {rows.length ? <ul className="divide-y divide-[#eeeae2]">
        {rows.map((row) => {
          const canSelect = !row.verified && row.formatValid && !row.duplicate;
          return <li key={row.userId} data-voen-row className="grid gap-2 p-4 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
            <input type="checkbox" aria-label={`${row.displayName} seç`} disabled={!canSelect} checked={selected.has(row.userId)} onChange={() => toggle(row.userId)} className="h-5 w-5 accent-[#173c40] disabled:opacity-30" />
            <div className="min-w-0">
              <p className="font-medium text-[#0d1b2a]">{row.displayName} <span className="font-normal text-slate-500">· {row.email}</span></p>
              <p className="mt-0.5 text-xs text-slate-500">{row.stores ? `${row.stores} mağaza: ${row.storeNames ?? ""}` : "Mağaza yoxdur"}{row.storeHref && <> · <Link href={row.storeHref} className="underline">Mağaza səhifəsi</Link></>}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-mono tracking-wider">{row.digits || "VÖEN yoxdur"}</span>
                {row.digits && <button type="button" onClick={() => void copy(row.digits)} className="inline-flex items-center gap-1 text-xs text-[#176b63] underline"><Copy aria-hidden="true" size={12} />{copied === row.digits ? "Kopyalandı" : "Kopyala"}</button>}
                {!row.formatValid && row.digits && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Format yanlışdır</span>}
                {row.duplicate && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-800">Başqa satıcıda da var</span>}
                {row.kindLabel && <span className="text-xs text-slate-500">{row.kindLabel}</span>}
              </p>
            </div>
            <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${row.verified ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{row.verified ? "Təsdiqlənib" : "Yoxlanmayıb"}</span>
          </li>;
        })}
      </ul> : <p className="p-5 text-sm text-slate-500">Bu filtrə uyğun satıcı yoxdur.</p>}
    </div>
    {selectable.length > 0 && <div className="sticky bottom-3 grid gap-2 rounded-2xl border border-[#e7e3d9] bg-white p-4 shadow-lg sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <label className="grid gap-1 text-sm text-slate-700">Qısa qeyd (hamısı üçün, məcburi)
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="Məsələn: e-taxes-də bir-bir yoxlandı, adlar uyğundur" className={inputClass} />
      </label>
      <div className="flex flex-wrap gap-2">
        <a href={VOEN_LOOKUP_URL} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}><ExternalLink aria-hidden="true" size={14} />e-taxes-də yoxla</a>
        <button type="button" disabled={busy || !selected.size || note.trim().length < 3} onClick={() => void verifySelected()} className={buttonClass("primary")}>{busy ? "Gözləyin…" : `Seçilənləri təsdiqlə (${selected.size})`}</button>
      </div>
      {result && <div className="sm:col-span-2"><ResultMessage tone={result.tone}>{result.text}</ResultMessage></div>}
    </div>}
  </div>;
}
