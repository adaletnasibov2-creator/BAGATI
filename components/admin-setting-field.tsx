"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw, X } from "lucide-react";

/** Same shape as AdminSettingView in lib/settings/admin.ts (client components do not import lib/settings). */
export type SettingFieldView = {
  key: string;
  label: string;
  description: string;
  sensitive: boolean;
  sensitiveNotice: string | null;
  input: { kind: "percent"; min: number; max: number; step: number; unit: "%" } | { kind: "integer"; min: number; max: number; unit?: string } | { kind: "text"; minLength: number; maxLength: number; multiline?: boolean; placeholder?: string } | { kind: "announcement"; textMax: number };
  currentInput: string;
  currentDisplay: string;
  defaultDisplay: string;
  isDefault: boolean;
  version: number;
  changedBy: string | null;
  changedAt: string | null;
  storedValueInvalid: boolean;
  reason: { min: number; max: number };
  history: { id: string; version: number; action: "UPDATE" | "RESET" | "ROLLBACK"; valueDisplay: string; previousDisplay: string; reason: string | null; changedBy: string; changedAt: string; restorable: boolean }[];
};

type Pending =
  | { kind: "update"; value: string; toDisplay: string }
  | { kind: "reset"; toDisplay: string }
  | { kind: "restore"; revisionId: string; version: number; toDisplay: string };

const ACTION_LABELS = { UPDATE: "Dəyişiklik", RESET: "Standarta qaytarıldı", ROLLBACK: "Əvvəlki versiya bərpa edildi" } as const;
const field = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";
const button = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50";

function inputDisplay(view: SettingFieldView, raw: string) {
  const value = raw.trim().replace(",", ".");
  return view.input.kind === "percent" ? `${value}%` : value;
}

export default function AdminSettingField({ view }: { view: SettingFieldView }) {
  const router = useRouter();
  const [value, setValue] = useState(view.currentInput);
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  // After a save the page data refreshes; show the stored value again instead of the last typed text.
  useEffect(() => { setValue(view.currentInput); }, [view.version, view.currentInput]);

  const reasonRequired = view.sensitive;
  const reasonOk = !reasonRequired || (reason.trim().length >= view.reason.min && reason.trim().length <= view.reason.max);
  const confirmOk = !view.sensitive || confirmed;

  function start(next: Pending) {
    setPending(next); setReason(""); setConfirmed(false); setError(""); setMessage(""); setConflict(false);
  }

  async function send() {
    if (!pending || busy) return;
    setBusy(true); setError(""); setConflict(false);
    const base = { expectedVersion: view.version, reason: reason.trim() || null, ...(view.sensitive ? { confirm: true } : {}) };
    const encoded = encodeURIComponent(view.key);
    const request = pending.kind === "update"
      ? { url: `/api/admin/settings/${encoded}`, method: "PUT", body: { ...base, value: pending.value } }
      : pending.kind === "reset"
        ? { url: `/api/admin/settings/${encoded}/reset`, method: "POST", body: base }
        : { url: `/api/admin/settings/${encoded}/restore`, method: "POST", body: { ...base, revisionId: pending.revisionId } };
    try {
      const response = await fetch(request.url, { method: request.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setConflict(response.status === 409 && result.code === "VERSION_CONFLICT");
        throw new Error(result.error || "Yadda saxlamaq alınmadı.");
      }
      setPending(null);
      setMessage(result.message || "Yadda saxlanıldı.");
      router.refresh();
    } catch (reasonError) {
      setError(reasonError instanceof Error ? reasonError.message : "Yadda saxlamaq alınmadı.");
    } finally {
      setBusy(false);
    }
  }

  const inputProps = view.input.kind === "percent"
    ? { inputMode: "decimal" as const, placeholder: `${view.input.min}–${view.input.max}`, maxLength: 5 }
    : view.input.kind === "integer"
      ? { inputMode: "numeric" as const, placeholder: `${view.input.min}–${view.input.max}`, maxLength: 6 }
      : view.input.kind === "text" ? { maxLength: view.input.maxLength } : {};

  return <section className="rounded-2xl border border-[#e7e3d9] bg-white p-5" aria-labelledby={`setting-${view.key}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={`setting-${view.key}`} className="font-semibold text-[#0d1b2a]">{view.label}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{view.description}</p>
      </div>
      {view.isDefault
        ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">Standart dəyər</span>
        : <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900">Dəyişdirilib</span>}
    </div>

    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
      <div><dt className="text-xs text-slate-500">Hazırkı dəyər</dt><dd className="mt-0.5 font-semibold text-slate-900">{view.currentDisplay}</dd></div>
      <div><dt className="text-xs text-slate-500">Standart dəyər</dt><dd className="mt-0.5 text-slate-800">{view.defaultDisplay}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-slate-500">Son dəyişiklik</dt><dd className="mt-0.5 break-words text-slate-800">{view.changedAt ? `${view.changedBy}, ${view.changedAt} (Bakı vaxtı)` : "Dəyişdirilməyib"}</dd></div>
    </dl>
    {view.storedValueInvalid && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">Saxlanmış dəyər qaydalara uyğun deyil, ona görə standart dəyər tətbiq olunur. Yeni dəyər yadda saxlayın və ya standarta qaytarın.</p>}

    <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); start({ kind: "update", value: value.trim(), toDisplay: inputDisplay(view, value) }); }}>
      <label className="grid min-w-0 gap-1 text-sm text-slate-700">
        Yeni dəyər{view.input.kind === "percent" ? " (faizlə, məsələn 10)" : ""}
        <span className="flex items-center gap-2">
          <input name="value" value={value} onChange={(event) => setValue(event.target.value)} required className={`${field} w-32`} aria-describedby={`setting-${view.key}-hint`} {...inputProps} />
          {view.input.kind === "percent" && <span className="text-sm text-slate-600">%</span>}
        </span>
      </label>
      <button type="submit" disabled={busy || !value.trim()} className={`${button} bg-[#173c40] text-white`}>Yadda saxla</button>
      {!view.isDefault && <button type="button" disabled={busy} onClick={() => start({ kind: "reset", toDisplay: view.defaultDisplay })} className={`${button} border border-[#ded9cf] text-slate-700`}><RotateCcw size={16} aria-hidden />Standarta qaytar</button>}
      <button type="button" onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen} className={`${button} border border-[#ded9cf] text-slate-700`}><History size={16} aria-hidden />Tarixçə ({view.history.length})</button>
    </form>
    {view.input.kind === "percent" && <p id={`setting-${view.key}-hint`} className="mt-2 text-xs text-slate-500">{view.input.min}–{view.input.max}% aralığında, ən çox iki onluq rəqəm (addım {view.input.step}%).</p>}

    {pending && <div role="dialog" aria-modal="false" aria-labelledby={`confirm-${view.key}`} className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p id={`confirm-${view.key}`} className="font-semibold">
        {pending.kind === "update" ? "Dəyişikliyi təsdiqləyin" : pending.kind === "reset" ? "Standart dəyərə qaytarılsın?" : `Versiya ${pending.version} bərpa edilsin?`}
      </p>
      <p className="mt-2"><span className="font-medium">{view.currentDisplay}</span> → <span className="font-medium">{pending.toDisplay}</span></p>
      {view.sensitiveNotice && <p className="mt-2 font-medium">{view.sensitiveNotice}</p>}
      <label className="mt-3 grid gap-1">
        Səbəb{reasonRequired ? ` (məcburi, ${view.reason.min}–${view.reason.max} simvol)` : " (istəyə bağlı)"}
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={view.reason.max} rows={2} className={field} />
      </label>
      {view.sensitive && <label className="mt-3 flex items-start gap-2">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
        <span>Dəyişikliyin yalnız yeni sifarişlərə tətbiq olunduğunu başa düşürəm.</span>
      </label>}
      {error && <div role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-red-800">
        <p>{error}</p>
        {conflict && <button type="button" onClick={() => { setPending(null); router.refresh(); }} className="mt-2 font-semibold underline">Səhifəni yenilə</button>}
      </div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !reasonOk || !confirmOk} onClick={send} className={`${button} bg-[#173c40] text-white`}>{busy ? "Göndərilir…" : "Təsdiqlə və yadda saxla"}</button>
        <button type="button" disabled={busy} onClick={() => setPending(null)} className={`${button} border border-[#ded9cf] bg-white text-slate-700`}>İmtina</button>
      </div>
    </div>}
    {message && <p role="status" className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}

    {historyOpen && <div className="mt-4 rounded-xl border border-[#e7e3d9] bg-[#f8f7f4] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-[#0d1b2a]">Dəyişiklik tarixçəsi</h3>
        <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Tarixçəni bağla" className="rounded-lg p-1 text-slate-500"><X size={16} aria-hidden /></button>
      </div>
      {!view.history.length
        ? <p className="mt-2 text-sm text-slate-500">Hələ dəyişiklik olmayıb.</p>
        : <ol className="mt-3 grid gap-3">{view.history.map((item) => <li key={item.id} className="rounded-lg border border-[#e7e3d9] bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-slate-900">v{item.version} · {ACTION_LABELS[item.action]}</span>
            <span className="text-xs text-slate-500">{item.changedAt} (Bakı)</span>
          </div>
          <p className="mt-1 text-slate-700">{item.previousDisplay} → <span className="font-medium">{item.valueDisplay}</span></p>
          <p className="mt-1 break-words text-xs text-slate-500">{item.changedBy}{item.reason ? ` · Səbəb: ${item.reason}` : ""}</p>
          {item.restorable && <button type="button" disabled={busy} onClick={() => start({ kind: "restore", revisionId: item.id, version: item.version, toDisplay: item.valueDisplay })} className="mt-2 text-sm font-semibold text-[#173c40] underline">Bu versiyanı bərpa et</button>}
        </li>)}</ol>}
    </div>}
  </section>;
}
