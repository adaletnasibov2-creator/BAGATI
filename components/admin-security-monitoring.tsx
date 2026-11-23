"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, ListChecks, Siren, SlidersHorizontal, XCircle } from "lucide-react";

/*
 * Client-only: talks to /api/admin/security/* and never imports server modules.
 * SECURITY-PAGE-1: only the incident and alert-rule tools remain here (/admin/security-center/incidents). The live panel
 * (15 s polling), the sources tab and the nested older center were removed; the summary is the server page
 * app/admin/security-center/page.tsx and the event list is app/admin/security-center/events/page.tsx.
 * SECURITY-CENTER-DESIGN-2: the light admin look (it was a dark panel), the page header and tabs come from the server
 * page, every incident row has "Qəbul et" / "Həll edildi" right in the list with a visible result, and the list loads
 * again when the page's "Yenilə" re-renders it (refreshedAt). Same endpoints, same checks, same audit rows.
 */

type Tab = "incidents" | "rules";
type IncidentStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "FALSE_POSITIVE";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type Incident = {
  id: string; ruleKey: string; title: string; severity: Severity; status: IncidentStatus; observedValue: number; threshold: number; windowMinutes: number;
  windowStart: string; windowEnd: string; acknowledgedAt: string | null; resolvedAt: string | null; createdAt: string; updatedAt: string;
  assigneeId: string | null; assignee: string | null; acknowledgedBy: string | null; resolvedBy: string | null; noteCount: number; allowedTransitions: IncidentStatus[];
  notes?: Array<{ id: string; body: string; createdAt: string; author: string }>;
};
type RuleSettings = { enabled: boolean; threshold: number; windowMinutes: number; cooldownMinutes: number };
type Rule = { key: string; label: string; description: string; severity: Severity; defaults: RuleSettings; settings: RuleSettings; isDefault: boolean; version: number; updatedAt: string | null; updatedBy: string | null };
type Bounds = { threshold: [number, number]; windowMinutes: [number, number]; cooldownMinutes: [number, number] };

const TABS: Array<{ id: Tab; label: string; icon: typeof Siren }> = [
  { id: "incidents", label: "İnsidentlər", icon: Siren },
  { id: "rules", label: "Qaydalar", icon: SlidersHorizontal },
];

const STATUS_LABELS: Record<IncidentStatus, string> = { OPEN: "Açıq", ACKNOWLEDGED: "Qəbul edilib", RESOLVED: "Həll edilib", FALSE_POSITIVE: "Yanlış həyəcan" };
const STATUS_ACTIONS: Record<IncidentStatus, string> = { OPEN: "Yenidən aç", ACKNOWLEDGED: "Qəbul et", RESOLVED: "Həll edildi", FALSE_POSITIVE: "Yanlış həyəcan" };
const SEVERITY_LABELS: Record<Severity, string> = { LOW: "Aşağı", MEDIUM: "Orta", HIGH: "Yüksək", CRITICAL: "Kritik" };
type Tone = "good" | "warn" | "bad" | "neutral";
const SEVERITY_TONES: Record<Severity, Tone> = { LOW: "neutral", MEDIUM: "warn", HIGH: "bad", CRITICAL: "bad" };
const STATUS_TONES: Record<IncidentStatus, Tone> = { OPEN: "warn", ACKNOWLEDGED: "neutral", RESOLVED: "good", FALSE_POSITIVE: "neutral" };
const TONE_CLASSES: Record<Tone, string> = {
  good: "bg-green-50 text-green-900 ring-green-200",
  warn: "bg-amber-50 text-amber-900 ring-amber-200",
  bad: "bg-red-50 text-red-800 ring-red-200",
  neutral: "bg-[#f3f1ec] text-slate-600 ring-[#e7e3d9]",
};
const TONE_ICONS: Record<Tone, typeof Clock> = { good: CheckCircle2, warn: AlertTriangle, bad: XCircle, neutral: Clock };

const panelClass = "rounded-2xl border border-[#e7e3d9] bg-white p-4 sm:p-5";
const inputClass = "min-h-11 w-full rounded-xl border border-[#ded9cf] bg-white px-3 text-sm text-[#0d1b2a] outline-none focus:border-[#173c40] focus:ring-2 focus:ring-[#173c40]/20";
const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173c40]";
const primary = "border-[#173c40] bg-[#173c40] text-white hover:bg-[#10302f]";
const secondary = "border-[#c7ad78] bg-white text-[#85621d] hover:bg-[#fbf8f1]";
const plain = "border-[#e7e3d9] bg-white text-slate-700 hover:bg-[#f8f7f4]";
const ACTION_CLASSES: Record<IncidentStatus, string> = { RESOLVED: primary, ACKNOWLEDGED: secondary, FALSE_POSITIVE: plain, OPEN: plain };

const time = (value: string | null) => (value ? new Intl.DateTimeFormat("az-AZ", { timeZone: "Asia/Baku", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "—");
const dateTime = (value: string | null) => (value ? new Intl.DateTimeFormat("az-AZ", { timeZone: "Asia/Baku", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—");
const number = (value: number) => new Intl.NumberFormat("az-AZ").format(value);

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(typeof body.error === "string" ? body.error : "Sorğu alınmadı."), { status: response.status });
  return body as T;
}

/** Badge: icon + text, never colour alone. */
function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = TONE_ICONS[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLASSES[tone]}`}><Icon size={12} aria-hidden="true" />{children}</span>;
}

function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p>;
}

export default function AdminSecurityMonitoring({ refreshedAt }: { refreshedAt?: string }) {
  const [tab, setTab] = useState<Tab>("incidents");
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some((item) => item.id === requested)) setTab(requested as Tab);
  }, []);
  const select = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="min-w-0">
      <div role="tablist" aria-label="İnsidentlər və qaydalar" className="mb-4 flex flex-wrap gap-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => select(id)}
            className={`${buttonClass} ${tab === id ? primary : plain}`}>
            <Icon size={15} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      {tab === "incidents" && <IncidentsPanel refreshedAt={refreshedAt} />}
      {tab === "rules" && <RulesPanel />}
    </div>
  );
}

function IncidentsPanel({ refreshedAt }: { refreshedAt?: string }) {
  const [status, setStatus] = useState<IncidentStatus | "ALL">("OPEN");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Incident[]; total: number; pageSize: number; assignees: Array<{ id: string; email: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ page: String(page), ...(status === "ALL" ? {} : { status }) });
      setData(await requestJson(`/api/admin/security/incidents?${query}`));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sorğu alınmadı.");
    }
  }, [page, status]);
  useEffect(() => { void load(); }, [load, refreshedAt]);
  const updateItem = (updated: Incident) => setData((current) => current && { ...current, items: current.items.map((item) => (item.id === updated.id ? { ...updated, notes: undefined } : item)) });
  // One-click status change from the list: the same PATCH (expectedStatus conflict check, audit row) as the details.
  const quick = async (incident: Incident, next: IncidentStatus) => {
    setBusyId(incident.id);
    setResult(null);
    try {
      const body = await requestJson<{ incident: Incident }>(`/api/admin/security/incidents/${incident.id}`, { method: "PATCH", body: JSON.stringify({ expectedStatus: incident.status, status: next, comment: null }) });
      updateItem(body.incident);
      setError(null);
      setResult(`İnsidentin statusu dəyişdi: ${STATUS_LABELS[body.incident.status]}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sorğu alınmadı.");
    } finally {
      setBusyId(null);
    }
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Status filtri">
        {(["OPEN", "ACKNOWLEDGED", "RESOLVED", "FALSE_POSITIVE", "ALL"] as const).map((item) => (
          <button key={item} type="button" aria-pressed={status === item} onClick={() => { setStatus(item); setPage(1); setOpenId(null); setResult(null); }}
            className={`${buttonClass} ${status === item ? primary : plain}`}>
            {item === "ALL" ? "Hamısı" : STATUS_LABELS[item]}
          </button>
        ))}
      </div>
      <ErrorBox message={error} />
      <div role="status" aria-live="polite">{result && <p className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900"><CheckCircle2 size={16} aria-hidden="true" />{result}</p>}</div>
      {!data ? <p role="status" className={`${panelClass} text-sm text-slate-600`}>Yüklənir…</p> : data.items.length === 0 ? (
        <p className={`${panelClass} text-sm text-slate-500`}>Bu statusda insident yoxdur.</p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((incident) => (
            <li key={incident.id} className={panelClass} data-incident-row={incident.status}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={SEVERITY_TONES[incident.severity]}>{SEVERITY_LABELS[incident.severity]}</Badge>
                    <Badge tone={STATUS_TONES[incident.status]}>{STATUS_LABELS[incident.status]}</Badge>
                    <span className="text-xs text-slate-500">{dateTime(incident.createdAt)}</span>
                  </div>
                  <p className="mt-1.5 break-words text-sm font-medium text-[#0d1b2a]">{incident.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">Məsul: {incident.assignee ?? "təyin edilməyib"} · Qeydlər: {incident.noteCount}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {incident.allowedTransitions.filter((next) => next === "ACKNOWLEDGED" || next === "RESOLVED").map((next) => (
                    <button key={next} type="button" disabled={busyId === incident.id} onClick={() => void quick(incident, next)} className={`${buttonClass} ${ACTION_CLASSES[next]}`}>{STATUS_ACTIONS[next]}</button>
                  ))}
                  <button type="button" aria-expanded={openId === incident.id} onClick={() => setOpenId(openId === incident.id ? null : incident.id)} className={`${buttonClass} ${plain}`}>
                    {openId === incident.id ? "Bağla" : "Ətraflı"}
                  </button>
                </div>
              </div>
              {openId === incident.id && <IncidentDetail id={incident.id} assignees={data.assignees} onChanged={updateItem} />}
            </li>
          ))}
        </ul>
      )}
      {data && pages > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm text-slate-500">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className={`${buttonClass} ${plain}`}><ChevronLeft size={15} aria-hidden="true" /> Əvvəlki</button>
          <span>{page} / {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className={`${buttonClass} ${plain}`}>Növbəti <ChevronRight size={15} aria-hidden="true" /></button>
        </div>
      )}
    </div>
  );
}

/** Changes update the list item in place (it stays visible under the current filter until the filter changes). */
function IncidentDetail({ id, assignees, onChanged }: { id: string; assignees: Array<{ id: string; email: string }>; onChanged: (incident: Incident) => void }) {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    requestJson<{ incident: Incident }>(`/api/admin/security/incidents/${id}`).then((body) => setIncident(body.incident)).catch((caught) => setError(caught instanceof Error ? caught.message : "Sorğu alınmadı."));
  }, [id]);
  const patch = async (change: { status?: IncidentStatus; assigneeId?: string | null }) => {
    if (!incident) return;
    setBusy(true);
    try {
      const body = await requestJson<{ incident: Incident }>(`/api/admin/security/incidents/${id}`, { method: "PATCH", body: JSON.stringify({ expectedStatus: incident.status, ...change, comment: comment.trim() || null }) });
      setIncident(body.incident);
      setComment("");
      setError(null);
      onChanged(body.incident);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sorğu alınmadı.");
    } finally {
      setBusy(false);
    }
  };
  const addNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      const body = await requestJson<{ incident: Incident }>(`/api/admin/security/incidents/${id}/notes`, { method: "POST", body: JSON.stringify({ body: note.trim() }) });
      setIncident(body.incident);
      setNote("");
      setError(null);
      onChanged(body.incident);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sorğu alınmadı.");
    } finally {
      setBusy(false);
    }
  };
  if (!incident) return <div className="mt-4"><ErrorBox message={error} />{!error && <p className="text-sm text-slate-500">Yüklənir…</p>}</div>;
  return (
    <div className="mt-4 grid gap-4 border-t border-[#eeeae2] pt-4 lg:grid-cols-2">
      <div className="space-y-3 text-sm text-slate-700">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-slate-500">Ölçülən dəyər</dt><dd className="tabular-nums">{incident.observedValue} (hədd {incident.threshold})</dd>
          <dt className="text-slate-500">Pəncərə</dt><dd>{dateTime(incident.windowStart)} – {time(incident.windowEnd)}</dd>
          <dt className="text-slate-500">Qəbul edib</dt><dd className="break-words">{incident.acknowledgedBy ?? "—"} {incident.acknowledgedAt ? `· ${dateTime(incident.acknowledgedAt)}` : ""}</dd>
          <dt className="text-slate-500">Bağlayıb</dt><dd className="break-words">{incident.resolvedBy ?? "—"} {incident.resolvedAt ? `· ${dateTime(incident.resolvedAt)}` : ""}</dd>
        </dl>
        <label className="block text-xs">
          <span className="text-slate-500">Məsul şəxs</span>
          <select className={`${inputClass} mt-1`} value={incident.assigneeId ?? ""} disabled={busy} onChange={(event) => void patch({ assigneeId: event.target.value || null })}>
            <option value="">Təyin edilməyib</option>
            {assignees.map((admin) => <option key={admin.id} value={admin.id}>{admin.email}</option>)}
          </select>
        </label>
        <label className="block text-xs">
          <span className="text-slate-500">Status dəyişikliyinə şərh (istəyə görə)</span>
          <textarea className={`${inputClass} mt-1 min-h-16 py-2`} maxLength={1500} value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          {incident.allowedTransitions.map((next) => (
            <button key={next} type="button" disabled={busy} onClick={() => void patch({ status: next })} className={`${buttonClass} ${ACTION_CLASSES[next]}`}>
              {STATUS_ACTIONS[next]}
            </button>
          ))}
        </div>
        <ErrorBox message={error} />
      </div>
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><ListChecks size={14} aria-hidden="true" /> Qeydlər</h3>
        <ol className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
          {(incident.notes ?? []).map((item) => (
            <li key={item.id} className="rounded-xl border border-[#eeeae2] bg-[#f8f7f4] p-2 text-xs">
              <p className="text-[11px] text-slate-500">{item.author} · {dateTime(item.createdAt)}</p>
              <p className="mt-1 whitespace-pre-line break-words text-slate-700">{item.body}</p>
            </li>
          ))}
        </ol>
        <form onSubmit={addNote} className="mt-3 space-y-2">
          <label className="block text-xs text-slate-500" htmlFor={`note-${id}`}>Yeni qeyd</label>
          <textarea id={`note-${id}`} className={`${inputClass} min-h-16 py-2`} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
          <button type="submit" disabled={busy || !note.trim()} className={`${buttonClass} ${secondary}`}>Qeyd əlavə et</button>
        </form>
      </div>
    </div>
  );
}

function RulesPanel() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const body = await requestJson<{ rules: Rule[]; bounds: Bounds }>("/api/admin/security/rules");
      setRules(body.rules);
      setBounds(body.bounds);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sorğu alınmadı.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">Hər qayda pəncərə ərzində həddə çatanda bir insident açır; gözləmə müddətində eyni qayda yeni insident açmır. Dəyişikliklər audit jurnalına yazılır.</p>
      <ErrorBox message={error} />
      {!rules || !bounds ? <p role="status" className={`${panelClass} text-sm text-slate-600`}>Yüklənir…</p> : (
        <div className="grid gap-4 xl:grid-cols-2">
          {rules.map((rule) => <RuleCard key={`${rule.key}:${rule.version}`} rule={rule} bounds={bounds} onSaved={(updated) => setRules((current) => current?.map((item) => (item.key === updated.key ? updated : item)) ?? null)} />)}
        </div>
      )}
    </div>
  );
}

function RuleCard({ rule, bounds, onSaved }: { rule: Rule; bounds: Bounds; onSaved: (rule: Rule) => void }) {
  const [form, setForm] = useState(rule.settings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(rule.settings);
  const valid = (["threshold", "windowMinutes", "cooldownMinutes"] as const).every((field) => Number.isInteger(form[field]) && form[field] >= bounds[field][0] && form[field] <= bounds[field][1]);
  const send = async (method: "PUT" | "DELETE") => {
    setBusy(true);
    try {
      const body = await requestJson<{ rule: Rule }>(`/api/admin/security/rules/${rule.key}`, { method, body: JSON.stringify(method === "PUT" ? { settings: form, expectedVersion: rule.version } : { expectedVersion: rule.version }) });
      onSaved(body.rule);
    } catch (caught) {
      setMessage({ ok: false, text: caught instanceof Error ? caught.message : "Sorğu alınmadı." });
      setBusy(false);
    }
  };
  const field = (key: "threshold" | "windowMinutes" | "cooldownMinutes", label: string, unit: string) => (
    <label className="block text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input type="number" inputMode="numeric" className={inputClass} min={bounds[key][0]} max={bounds[key][1]} step={1} value={Number.isNaN(form[key]) ? "" : form[key]}
          onChange={(event) => { setForm({ ...form, [key]: event.target.valueAsNumber }); setMessage(null); }} aria-describedby={`${rule.key}-${key}-hint`} />
        <span className="shrink-0 text-slate-500">{unit}</span>
      </span>
      <span id={`${rule.key}-${key}-hint`} className="mt-1 block text-[11px] text-slate-500">Standart {rule.defaults[key]} · {bounds[key][0]}–{number(bounds[key][1])}</span>
    </label>
  );
  return (
    <article className={`${panelClass} min-w-0`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-[#0d1b2a]">{rule.label}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{rule.description}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={SEVERITY_TONES[rule.severity]}>{SEVERITY_LABELS[rule.severity]}</Badge>
          <Badge tone={rule.isDefault ? "neutral" : "warn"}>{rule.isDefault ? "Standart" : "Dəyişdirilib"}</Badge>
        </div>
      </div>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="h-4 w-4 accent-[#173c40]" checked={form.enabled} onChange={(event) => { setForm({ ...form, enabled: event.target.checked }); setMessage(null); }} />
        Aktivdir
      </label>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {field("threshold", "Hədd", "say")}
        {field("windowMinutes", "Pəncərə", "dəq")}
        {field("cooldownMinutes", "Gözləmə", "dəq")}
      </div>
      {!rule.isDefault && <p className="mt-2 text-[11px] text-slate-500">Son dəyişiklik: {rule.updatedBy ?? "—"} · {dateTime(rule.updatedAt)} · versiya {rule.version}</p>}
      {!valid && <p className="mt-2 text-xs text-amber-900"><AlertTriangle size={13} className="mr-1 inline" aria-hidden="true" />Dəyərlər icazə verilən hədlərdə tam ədəd olmalıdır.</p>}
      {message && <p role={message.ok ? "status" : "alert"} className={`mt-2 text-xs ${message.ok ? "text-green-900" : "text-red-800"}`}>{message.text}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !dirty || !valid} onClick={() => void send("PUT")} className={`${buttonClass} ${primary}`}>Yadda saxla</button>
        {dirty && <button type="button" disabled={busy} onClick={() => setForm(rule.settings)} className={`${buttonClass} ${plain}`}>Ləğv et</button>}
        {!rule.isDefault && <button type="button" disabled={busy} onClick={() => void send("DELETE")} className={`${buttonClass} ${plain}`}>Standarta qaytar</button>}
      </div>
    </article>
  );
}
