"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw, X } from "lucide-react";
import { ANNOUNCEMENT_TONE_LABELS } from "@/lib/announcement";
import { ANNOUNCEMENT_TONE_CLASSES } from "@/components/announcement-tones";

/** Same shape as AdminSettingView in lib/settings/admin.ts (client components do not import lib/settings). */
export type SettingFieldView = {
  key: string;
  label: string;
  description: string;
  sensitive: boolean;
  sensitiveNotice: string | null;
  input:
    | { kind: "percent"; min: number; max: number; step: number; unit: "%" }
    | { kind: "integer"; min: number; max: number; unit?: string }
    | { kind: "text"; minLength: number; maxLength: number; multiline?: boolean; placeholder?: string; mustContain?: string }
    | { kind: "announcement"; textMax: number };
  currentInput: string;
  currentDisplay: string;
  defaultDisplay: string;
  isDefault: boolean;
  version: number;
  changedBy: string | null;
  changedAt: string | null;
  storedValueInvalid: boolean;
  currentForm: Record<string, string | boolean> | null;
  cached: boolean;
  reason: { min: number; max: number };
  history: { id: string; version: number; action: "UPDATE" | "RESET" | "ROLLBACK"; valueDisplay: string; previousDisplay: string; reason: string | null; changedBy: string; changedAt: string; restorable: boolean }[];
};

type AnnouncementForm = { enabled: boolean; text: string; href: string; tone: "info" | "success" | "warning" | "danger"; startsAt: string; endsAt: string };
type Pending =
  | { kind: "update"; value: unknown; toDisplay: string }
  | { kind: "reset"; toDisplay: string }
  | { kind: "restore"; revisionId: string; version: number; toDisplay: string };

const ACTION_LABELS = { UPDATE: "Dəyişiklik", RESET: "Standarta qaytarıldı", ROLLBACK: "Əvvəlki versiya bərpa edildi" } as const;
const field = "w-full rounded-xl border border-[#ded9cf] bg-white px-3 py-2.5 text-sm";
const button = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50";
const TONES = ["info", "success", "warning", "danger"] as const;

function toAnnouncementForm(form: Record<string, string | boolean> | null): AnnouncementForm {
  const tone = TONES.find((item) => item === form?.tone) ?? "info";
  return { enabled: form?.enabled === true, text: String(form?.text ?? ""), href: String(form?.href ?? ""), tone, startsAt: String(form?.startsAt ?? ""), endsAt: String(form?.endsAt ?? "") };
}

/** Client-side mirror of the server rules, for messages while typing. The server validates again on save. */
export function settingInputIssue(input: SettingFieldView["input"], value: string | AnnouncementForm): string {
  if (typeof value !== "string") {
    if (input.kind !== "announcement") return "";
    const text = value.text.replace(/\s+/g, " ").trim();
    if (value.enabled && !text) return "Aktiv elan üçün mətn yazın.";
    if (text.length > input.textMax) return `Mətn ən çox ${input.textMax} simvol ola bilər.`;
    const href = value.href.trim();
    if (href && !(/^\/(?!\/)/.test(href) || /^https:\/\/[^\s@/]+(\/|$)/.test(href))) return "Keçid / ilə başlamalı və ya HTTPS ünvanı olmalıdır.";
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) return "Bitmə vaxtı başlanğıcdan sonra olmalıdır.";
    return "";
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (input.kind === "text") {
    if (trimmed.length < input.minLength || trimmed.length > input.maxLength) return `${input.minLength}–${input.maxLength} simvol yazın (indi ${trimmed.length}).`;
    if (input.mustContain && trimmed.split(input.mustContain).length - 1 !== 1) return `Mətndə ${input.mustContain} yer tutucusu düz bir dəfə olmalıdır.`;
    return "";
  }
  if (input.kind === "integer") {
    const number = /^\d{1,6}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
    return Number.isInteger(number) && number >= input.min && number <= input.max ? "" : `${input.min} ilə ${input.max} arasında tam ədəd yazın.`;
  }
  return "";
}

function displayFor(view: SettingFieldView, value: string | AnnouncementForm): string {
  if (typeof value !== "string") {
    if (!value.enabled) return "Söndürülüb";
    const text = value.text.replace(/\s+/g, " ").trim();
    return `Aktiv (${ANNOUNCEMENT_TONE_LABELS[value.tone]}): ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`;
  }
  const trimmed = value.replace(/\s+/g, " ").trim().replace(",", ".");
  if (view.input.kind === "percent") return `${trimmed}%`;
  if (view.input.kind === "integer") return `${trimmed}${view.input.unit ? ` ${view.input.unit}` : ""}`;
  return trimmed;
}

function AnnouncementEditor({ value, onChange, textMax }: { value: AnnouncementForm; onChange: (next: AnnouncementForm) => void; textMax: number }) {
  const set = (patch: Partial<AnnouncementForm>) => onChange({ ...value, ...patch });
  const previewText = value.text.replace(/\s+/g, " ").trim();
  return <div className="grid w-full gap-3">
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" checked={value.enabled} onChange={(event) => set({ enabled: event.target.checked })} />
      Elan zolağı aktivdir
    </label>
    <label className="grid gap-1 text-sm text-slate-700">Mətn (bir sətir)
      <input value={value.text} onChange={(event) => set({ text: event.target.value })} maxLength={textMax + 50} className={field} />
      <span className="text-xs text-slate-500">{previewText.length} / {textMax}</span>
    </label>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm text-slate-700">Keçid (istəyə bağlı)
        <input value={value.href} onChange={(event) => set({ href: event.target.value })} placeholder="/kampaniyalar və ya https://…" className={field} />
      </label>
      <label className="grid gap-1 text-sm text-slate-700">Növ
        <select value={value.tone} onChange={(event) => set({ tone: event.target.value as AnnouncementForm["tone"] })} className={field}>
          {TONES.map((tone) => <option key={tone} value={tone}>{ANNOUNCEMENT_TONE_LABELS[tone]}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm text-slate-700">Başlanğıc (Bakı vaxtı, istəyə bağlı)
        <input type="datetime-local" value={value.startsAt} onChange={(event) => set({ startsAt: event.target.value })} className={field} />
      </label>
      <label className="grid gap-1 text-sm text-slate-700">Bitmə (Bakı vaxtı, istəyə bağlı)
        <input type="datetime-local" value={value.endsAt} onChange={(event) => set({ endsAt: event.target.value })} className={field} />
      </label>
    </div>
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500">Önizləmə</p>
      <div aria-label="Elan zolağının önizləməsi" className={`${ANNOUNCEMENT_TONE_CLASSES[value.tone]} overflow-hidden rounded-xl text-sm ${value.enabled ? "" : "opacity-50"}`}>
        <div className="flex min-h-10 items-center gap-3 px-4 py-2">
          <p className="min-w-0 flex-1 break-words text-center font-medium leading-5">{previewText ? (value.href.trim() ? <span className="underline underline-offset-2">{previewText}</span> : previewText) : "Mətn yazın…"}</p>
          <X size={16} aria-hidden="true" />
        </div>
      </div>
      {!value.enabled && <p className="mt-1 text-xs text-slate-500">Söndürülüb: saytda göstərilmir.</p>}
    </div>
  </div>;
}

export default function AdminSettingField({ view }: { view: SettingFieldView }) {
  const router = useRouter();
  const composite = view.input.kind === "announcement";
  const [value, setValue] = useState(view.currentInput);
  const [form, setForm] = useState<AnnouncementForm>(toAnnouncementForm(view.currentForm));
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  // After a save the page data refreshes; show the stored value again instead of the last typed text.
  useEffect(() => { setValue(view.currentInput); setForm(toAnnouncementForm(view.currentForm)); }, [view.version, view.currentInput, view.currentForm]);

  const reasonRequired = view.sensitive;
  const reasonOk = !reasonRequired || (reason.trim().length >= view.reason.min && reason.trim().length <= view.reason.max);
  const confirmOk = !view.sensitive || confirmed;
  const issue = settingInputIssue(view.input, composite ? form : value);
  const empty = composite ? false : !value.trim();

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

  const small = view.input.kind === "percent" || view.input.kind === "integer";
  const inputProps = view.input.kind === "percent"
    ? { inputMode: "decimal" as const, placeholder: `${view.input.min}–${view.input.max}`, maxLength: 5 }
    : view.input.kind === "integer"
      ? { inputMode: "numeric" as const, placeholder: `${view.input.min}–${view.input.max}`, maxLength: 6 }
      : view.input.kind === "text" ? { maxLength: view.input.maxLength + 50, placeholder: view.input.placeholder } : {};

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (issue || empty) return;
    if (composite) start({ kind: "update", value: { ...form, text: form.text.replace(/\s+/g, " ").trim() }, toDisplay: displayFor(view, form) });
    else start({ kind: "update", value: value.trim(), toDisplay: displayFor(view, value) });
  }

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
      <div className="min-w-0"><dt className="text-xs text-slate-500">Hazırkı dəyər</dt><dd className="mt-0.5 break-words font-semibold text-slate-900">{view.currentDisplay}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-slate-500">Standart dəyər</dt><dd className="mt-0.5 break-words text-slate-800">{view.defaultDisplay}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-slate-500">Son dəyişiklik</dt><dd className="mt-0.5 break-words text-slate-800">{view.changedAt ? `${view.changedBy}, ${view.changedAt} (Bakı vaxtı)` : "Dəyişdirilməyib"}</dd></div>
    </dl>
    {view.storedValueInvalid && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">Saxlanmış dəyər qaydalara uyğun deyil, ona görə standart dəyər tətbiq olunur. Yeni dəyər yadda saxlayın və ya standarta qaytarın.</p>}

    <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={submit}>
      {composite
        ? <AnnouncementEditor value={form} onChange={setForm} textMax={view.input.kind === "announcement" ? view.input.textMax : 200} />
        : <label className={`grid min-w-0 gap-1 text-sm text-slate-700 ${small ? "" : "w-full"}`}>
          Yeni dəyər{view.input.kind === "percent" ? " (faizlə, məsələn 10)" : ""}
          <span className="flex items-center gap-2">
            {view.input.kind === "text" && view.input.multiline
              ? <textarea name="value" value={value} onChange={(event) => setValue(event.target.value)} rows={3} className={field} aria-describedby={`setting-${view.key}-hint`} maxLength={view.input.maxLength + 50} placeholder={view.input.placeholder} />
              : <input name="value" value={value} onChange={(event) => setValue(event.target.value)} className={`${field} ${small ? "w-32" : ""}`} aria-describedby={`setting-${view.key}-hint`} {...inputProps} />}
            {view.input.kind === "percent" && <span className="text-sm text-slate-600">%</span>}
            {view.input.kind === "integer" && view.input.unit && <span className="text-sm text-slate-600">{view.input.unit}</span>}
          </span>
        </label>}
      <button type="submit" disabled={busy || Boolean(issue) || empty} className={`${button} bg-[#173c40] text-white`}>Yadda saxla</button>
      {!view.isDefault && <button type="button" disabled={busy} onClick={() => start({ kind: "reset", toDisplay: view.defaultDisplay })} className={`${button} border border-[#ded9cf] text-slate-700`}><RotateCcw size={16} aria-hidden />Standarta qaytar</button>}
      <button type="button" onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen} className={`${button} border border-[#ded9cf] text-slate-700`}><History size={16} aria-hidden />Tarixçə ({view.history.length})</button>
    </form>
    <div id={`setting-${view.key}-hint`} className="mt-2 grid gap-1 text-xs">
      {view.input.kind === "percent" && <p className="text-slate-500">{view.input.min}–{view.input.max}% aralığında, ən çox iki onluq rəqəm (addım {view.input.step}%).</p>}
      {view.input.kind === "integer" && <p className="text-slate-500">{view.input.min}–{view.input.max} aralığında tam ədəd.</p>}
      {view.input.kind === "text" && <p className="text-slate-500">{value.replace(/\s+/g, " ").trim().length} / {view.input.maxLength} simvol{view.input.minLength > 1 ? ` (ən azı ${view.input.minLength})` : ""}. Sətir keçidləri boşluğa çevrilir.</p>}
      {issue && !empty && <p className="font-medium text-red-700" aria-live="polite">{issue}</p>}
      {view.cached && <p className="text-slate-500">Dəyişiklik 30 saniyə ərzində tətbiq olunur.</p>}
    </div>

    {pending && <div role="dialog" aria-modal="false" aria-labelledby={`confirm-${view.key}`} className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p id={`confirm-${view.key}`} className="font-semibold">
        {pending.kind === "update" ? "Dəyişikliyi təsdiqləyin" : pending.kind === "reset" ? "Standart dəyərə qaytarılsın?" : `Versiya ${pending.version} bərpa edilsin?`}
      </p>
      <p className="mt-2 break-words"><span className="font-medium">{view.currentDisplay}</span> → <span className="font-medium">{pending.toDisplay}</span></p>
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
          <p className="mt-1 break-words text-slate-700">{item.previousDisplay} → <span className="font-medium">{item.valueDisplay}</span></p>
          <p className="mt-1 break-words text-xs text-slate-500">{item.changedBy}{item.reason ? ` · Səbəb: ${item.reason}` : ""}</p>
          {item.restorable && <button type="button" disabled={busy} onClick={() => start({ kind: "restore", revisionId: item.id, version: item.version, toDisplay: item.valueDisplay })} className="mt-2 text-sm font-semibold text-[#173c40] underline">Bu versiyanı bərpa et</button>}
        </li>)}</ol>}
    </div>}
  </section>;
}
