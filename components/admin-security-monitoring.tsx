"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, ListChecks, ShieldCheck, Siren, SlidersHorizontal } from "lucide-react";

/*
 * Client-only: talks to /api/admin/security/* and never imports server modules.
 * SECURITY-PAGE-1: only the incident and alert-rule tools remain here (/admin/security-center/incidents). The live panel
 * (15 s polling), the sources tab and the nested older center were removed; the summary is the server page
 * app/admin/security-center/page.tsx and the event list is app/admin/security-center/events/page.tsx.
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
const SEVERITY_CLASSES: Record<Severity, string> = {
  LOW: "border-slate-600 text-slate-300",
  MEDIUM: "border-amber-700 bg-amber-950/40 text-amber-200",
  HIGH: "border-orange-700 bg-orange-950/40 text-orange-200",
  CRITICAL: "border-rose-700 bg-rose-950/50 text-rose-200",
};
const STATUS_CLASSES: Record<IncidentStatus, string> = {
  OPEN: "border-rose-800 bg-rose-950/40 text-rose-200",
  ACKNOWLEDGED: "border-amber-800 bg-amber-950/40 text-amber-200",
  RESOLVED: "border-emerald-800 bg-emerald-950/40 text-emerald-200",
  FALSE_POSITIVE: "border-slate-600 bg-slate-800 text-slate-300",
};

const panelClass = "rounded-xl border border-slate-700 bg-slate-900 p-4 sm:p-5";
const inputClass = "min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-900";
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

const time = (value: string | null) => (value ? new Intl.DateTimeFormat("az-AZ", { timeZone: "Asia/Baku", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "—");
const dateTime = (value: string | null) => (value ? new Intl.DateTimeFormat("az-AZ", { timeZone: "Asia/Baku", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—");
const number = (value: number) => new Intl.NumberFormat("az-AZ").format(value);

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(typeof body.error === "string" ? body.error : "Sorğu alınmadı."), { status: response.status });
  return body as T;
}

function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>{children}</span>;
}

function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/60 px-3 py-2 text-sm text-rose-100">{message}</p>;
}


export default function AdminSecurityMonitoring() {
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
    <main className="min-h-screen rounded-2xl bg-[#07111b] text-slate-100">
      <header className="flex flex-col gap-4 border-b border-slate-800 p-4 sm:p-6 lg:px-8">
        <div>
          <Link href="/admin/security-center" prefetch={false} className="text-sm font-medium text-emerald-300">← Təhlükəsizlik mərkəzi</Link>
          <p className="mt-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.2em] text-emerald-300"><ShieldCheck size={15} aria-hidden="true" /> BAGATI · Təhlükəsizlik mərkəzi</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">İnsidentlər və qaydalar</h1>
        </div>
        <nav aria-label="Təhlükəsizlik mərkəzi bölmələri" className="-mx-1 overflow-x-auto">
          <ul role="tablist" className="flex min-w-max gap-1 px-1">
            {TABS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button
                  type="button" role="tab" aria-selected={tab === id} onClick={() => select(id)}
                  className={`flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm transition ${tab === id ? "bg-emerald-950/70 font-semibold text-emerald-200 ring-1 ring-emerald-800" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
                >
                  <Icon size={15} aria-hidden="true" /> {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <div className="p-4 sm:p-6 lg:px-8">
        {tab === "incidents" && <IncidentsPanel />}
        {tab === "rules" && <RulesPanel />}
      </div>
    </main>
  );
}

function IncidentsPanel() {
  const [status, setStatus] = useState<IncidentStatus | "ALL">("OPEN");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Incident[]; total: number; pageSize: number; assignees: Array<{ id: string; email: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ page: String(page), ...(status === "ALL" ? {} : { status }) });
      setData(await requestJson(`/api/admin/security/incidents?${query}`));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sorğu alınmadı.");
    }
  }, [page, status]);
  useEffect(() => { void load(); }, [load]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Status filtri">
        {(["OPEN", "ACKNOWLEDGED", "RESOLVED", "FALSE_POSITIVE", "ALL"] as const).map((item) => (
          <button key={item} type="button" aria-pressed={status === item} onClick={() => { setStatus(item); setPage(1); setOpenId(null); }}
            className={`${buttonClass} ${status === item ? "border-emerald-700 bg-emerald-950/60 text-emerald-100" : "border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800"}`}>
            {item === "ALL" ? "Hamısı" : STATUS_LABELS[item]}
          </button>
        ))}
      </div>
      <ErrorBox message={error} />
      {!data ? <p role="status" className={`${panelClass} text-sm text-slate-300`}>Yüklənir…</p> : data.items.length === 0 ? (
        <p className={`${panelClass} text-sm text-slate-400`}>Bu statusda insident yoxdur.</p>
      ) : (
        <ul className="space-y-3">
          {data.items.map((incident) => (
            <li key={incident.id} className={panelClass}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={SEVERITY_CLASSES[incident.severity]}>{SEVERITY_LABELS[incident.severity]}</Badge>
                    <Badge className={STATUS_CLASSES[incident.status]}>{STATUS_LABELS[incident.status]}</Badge>
                    <span className="text-[11px] text-slate-500">{dateTime(incident.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-white">{incident.title}</p>
                  <p className="mt-1 text-xs text-slate-400">Məsul: {incident.assignee ?? "təyin edilməyib"} · Qeydlər: {incident.noteCount}</p>
                </div>
                <button type="button" aria-expanded={openId === incident.id} onClick={() => setOpenId(openId === incident.id ? null : incident.id)} className={`${buttonClass} border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800`}>
                  {openId === incident.id ? "Bağla" : "Ətraflı"}
                </button>
              </div>
              {openId === incident.id && <IncidentDetail id={incident.id} assignees={data.assignees} onChanged={(updated) => setData((current) => current && { ...current, items: current.items.map((item) => (item.id === updated.id ? { ...updated, notes: undefined } : item)) })} />}
            </li>
          ))}
        </ul>
      )}
      {data && pages > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm text-slate-400">
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className={`${buttonClass} border-slate-700 bg-slate-900 text-slate-200`}><ChevronLeft size={15} aria-hidden="true" /> Əvvəlki</button>
          <span>{page} / {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage(page + 1)} className={`${buttonClass} border-slate-700 bg-slate-900 text-slate-200`}>Növbəti <ChevronRight size={15} aria-hidden="true" /></button>
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
  if (!incident) return <div className="mt-4"><ErrorBox message={error} />{!error && <p className="text-sm text-slate-400">Yüklənir…</p>}</div>;
  return (
    <div className="mt-4 grid gap-4 border-t border-slate-800 pt-4 lg:grid-cols-2">
      <div className="space-y-3 text-xs text-slate-300">
        <dl className="grid grid-cols-2 gap-2">
          <dt className="text-slate-500">Ölçülən dəyər</dt><dd className="tabular-nums">{incident.observedValue} (hədd {incident.threshold})</dd>
          <dt className="text-slate-500">Pəncərə</dt><dd>{dateTime(incident.windowStart)} – {time(incident.windowEnd)}</dd>
          <dt className="text-slate-500">Qəbul edib</dt><dd>{incident.acknowledgedBy ?? "—"} {incident.acknowledgedAt ? `· ${dateTime(incident.acknowledgedAt)}` : ""}</dd>
          <dt className="text-slate-500">Bağlayıb</dt><dd>{incident.resolvedBy ?? "—"} {incident.resolvedAt ? `· ${dateTime(incident.resolvedAt)}` : ""}</dd>
        </dl>
        <label className="block">
          <span className="text-slate-400">Məsul şəxs</span>
          <select className={`${inputClass} mt-1`} value={incident.assigneeId ?? ""} disabled={busy} onChange={(event) => void patch({ assigneeId: event.target.value || null })}>
            <option value="">Təyin edilməyib</option>
            {assignees.map((admin) => <option key={admin.id} value={admin.id}>{admin.email}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-slate-400">Status dəyişikliyinə şərh (istəyə görə)</span>
          <textarea className={`${inputClass} mt-1 min-h-16 py-2`} maxLength={1500} value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          {incident.allowedTransitions.map((next) => (
            <button key={next} type="button" disabled={busy} onClick={() => void patch({ status: next })}
              className={`${buttonClass} ${next === "RESOLVED" ? "border-emerald-700 bg-emerald-950/50 text-emerald-100" : next === "FALSE_POSITIVE" ? "border-slate-600 bg-slate-800 text-slate-200" : "border-amber-700 bg-amber-950/40 text-amber-100"}`}>
              {STATUS_ACTIONS[next]}
            </button>
          ))}
        </div>
        <ErrorBox message={error} />
      </div>
      <div>
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400"><ListChecks size={14} aria-hidden="true" /> Qeydlər</h3>
        <ol className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
          {(incident.notes ?? []).map((item) => (
            <li key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-xs">
              <p className="text-[11px] text-slate-500">{item.author} · {dateTime(item.createdAt)}</p>
              <p className="mt-1 whitespace-pre-line break-words text-slate-200">{item.body}</p>
            </li>
          ))}
        </ol>
        <form onSubmit={addNote} className="mt-3 space-y-2">
          <label className="block text-xs text-slate-400" htmlFor={`note-${id}`}>Yeni qeyd</label>
          <textarea id={`note-${id}`} className={`${inputClass} min-h-16 py-2`} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
          <button type="submit" disabled={busy || !note.trim()} className={`${buttonClass} border-emerald-700 bg-emerald-950/40 text-emerald-100`}>Qeyd əlavə et</button>
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
      <p className="text-sm text-slate-400">Hər qayda pəncərə ərzində həddə çatanda bir insident açır; gözləmə müddətində eyni qayda yeni insident açmır. Dəyişikliklər audit jurnalına yazılır.</p>
      <ErrorBox message={error} />
      {!rules || !bounds ? <p role="status" className={`${panelClass} text-sm text-slate-300`}>Yüklənir…</p> : (
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
      <span className="text-slate-400">{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input type="number" inputMode="numeric" className={inputClass} min={bounds[key][0]} max={bounds[key][1]} step={1} value={Number.isNaN(form[key]) ? "" : form[key]}
          onChange={(event) => { setForm({ ...form, [key]: event.target.valueAsNumber }); setMessage(null); }} aria-describedby={`${rule.key}-${key}-hint`} />
        <span className="shrink-0 text-slate-500">{unit}</span>
      </span>
      <span id={`${rule.key}-${key}-hint`} className="mt-1 block text-[10px] text-slate-500">Standart {rule.defaults[key]} · {bounds[key][0]}–{number(bounds[key][1])}</span>
    </label>
  );
  return (
    <article className={panelClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-white">{rule.label}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">{rule.description}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge className={SEVERITY_CLASSES[rule.severity]}>{SEVERITY_LABELS[rule.severity]}</Badge>
          <Badge className={rule.isDefault ? "border-slate-600 text-slate-300" : "border-sky-700 bg-sky-950/50 text-sky-200"}>{rule.isDefault ? "Standart" : "Dəyişdirilib"}</Badge>
        </div>
      </div>
      <label className="mt-3 flex min-h-10 items-center gap-2 text-sm text-slate-200">
        <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={form.enabled} onChange={(event) => { setForm({ ...form, enabled: event.target.checked }); setMessage(null); }} />
        Aktivdir
      </label>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {field("threshold", "Hədd", "say")}
        {field("windowMinutes", "Pəncərə", "dəq")}
        {field("cooldownMinutes", "Gözləmə", "dəq")}
      </div>
      {!rule.isDefault && <p className="mt-2 text-[11px] text-slate-500">Son dəyişiklik: {rule.updatedBy ?? "—"} · {dateTime(rule.updatedAt)} · versiya {rule.version}</p>}
      {!valid && <p className="mt-2 text-xs text-amber-200"><AlertTriangle size={13} className="mr-1 inline" aria-hidden="true" />Dəyərlər icazə verilən hədlərdə tam ədəd olmalıdır.</p>}
      {message && <p role={message.ok ? "status" : "alert"} className={`mt-2 text-xs ${message.ok ? "text-emerald-200" : "text-rose-200"}`}>{message.text}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !dirty || !valid} onClick={() => void send("PUT")} className={`${buttonClass} border-emerald-700 bg-emerald-950/50 text-emerald-100 hover:bg-emerald-900/50`}>Yadda saxla</button>
        {dirty && <button type="button" disabled={busy} onClick={() => setForm(rule.settings)} className={`${buttonClass} border-slate-700 bg-slate-900 text-slate-300`}>Ləğv et</button>}
        {!rule.isDefault && <button type="button" disabled={busy} onClick={() => void send("DELETE")} className={`${buttonClass} border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800`}>Standarta qaytar</button>}
      </div>
    </article>
  );
}
