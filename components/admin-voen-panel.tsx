"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink } from "lucide-react";
import { ResultMessage } from "@/components/admin-ui/result-message";
import { buttonClass, inputClass } from "@/components/admin-ui/styles";
import { VOEN_LOOKUP_URL } from "@/lib/voen";
import type { AdminVoenView } from "@/lib/voen-verification";

/**
 * Admin VÖEN check: the number, its kind (from the last digit), copy, "e-taxes-də yoxla" (official public taxpayer
 * search, opened in a new tab; the admin pastes the VÖEN there), the status (Yoxlanmayıb / Təsdiqlənib) and the
 * "VÖEN təsdiqləndi" / "Təsdiqi geri götür" actions, both with a required short note (saved and audited).
 */
export function AdminVoenPanel({ view }: { view: AdminVoenView }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const verified = view.status === "VERIFIED";
  const noteOk = note.trim().length >= 3;

  async function copy() {
    if (!view.voen) return;
    try { await navigator.clipboard.writeText(view.voen); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  }

  async function act(action: "verify" | "revoke") {
    if (busy || !noteOk || !view.voen) return;
    setBusy(true); setResult(null);
    try {
      const response = await fetch("/api/admin/voen-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, userId: view.userId, voen: view.voen, note }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "Yadda saxlamaq alınmadı.");
      setResult({ tone: "success", text: json.message || "Yadda saxlanıldı." });
      setNote("");
      router.refresh();
    } catch (error) {
      setResult({ tone: "error", text: error instanceof Error ? error.message : "Yadda saxlamaq alınmadı." });
    } finally {
      setBusy(false);
    }
  }

  return <section data-voen-panel className="rounded-card border border-line bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h2 className="font-semibold text-fg">VÖEN yoxlaması</h2>
      <span data-voen-status={view.status} className={`rounded-full px-3 py-1 text-xs font-semibold ${verified ? "bg-emerald-50 text-emerald-800" : "bg-surface-sunken text-fg-body"}`}>{view.statusLabel}</span>
    </div>
    {view.voen ? <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-lg tracking-wider text-fg">{view.voen}</span>
        <button type="button" onClick={() => void copy()} className={buttonClass("secondary")} aria-label="VÖEN-i kopyala"><Copy aria-hidden="true" size={14} />{copied ? "Kopyalandı" : "Kopyala"}</button>
        <a href={VOEN_LOOKUP_URL} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}><ExternalLink aria-hidden="true" size={14} />e-taxes-də yoxla</a>
      </div>
      <p className="mt-1 text-xs text-fg-secondary">{view.formatValid ? `Son rəqəmə görə: ${view.kindLabel}.` : "Format yanlışdır (köhnə dəyər): 10 rəqəm, sonuncu 1 və ya 2 olmalıdır. Satıcı düzəltməyincə təsdiq mümkün deyil."} Rəsmi axtarışda “VÖEN” meyarını seçib nömrəni yapışdırın.</p>
    </> : <p className="mt-3 text-sm text-fg-secondary">VÖEN qeyd edilməyib.</p>}
    {view.verifiedLabel && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Təsdiqləyib: {view.verifiedLabel}</p>}
    {view.revokedLabel && <p className="mt-3 rounded-lg bg-surface-page px-3 py-2 text-sm text-fg-body">{view.revokedLabel}</p>}
    {view.voen && (verified || view.formatValid) && <div className="mt-4 grid gap-2">
      <label className="grid gap-1 text-sm text-fg-body">Qısa qeyd (məcburi: nəyi yoxladınız)
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder={verified ? "Məsələn: satıcı səhv VÖEN göndərib" : "Məsələn: e-taxes-də yoxlandı, ad uyğundur"} className={inputClass} />
      </label>
      <div className="flex flex-wrap gap-2">
        {verified
          ? <button type="button" disabled={busy || !noteOk} onClick={() => void act("revoke")} className={buttonClass("secondary")}>{busy ? "Gözləyin…" : "Təsdiqi geri götür"}</button>
          : <button type="button" disabled={busy || !noteOk} onClick={() => void act("verify")} className={buttonClass("primary")}>{busy ? "Gözləyin…" : "VÖEN təsdiqləndi"}</button>}
      </div>
    </div>}
    {result && <div className="mt-3"><ResultMessage tone={result.tone}>{result.text}</ResultMessage></div>}
  </section>;
}
