"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Gauge, ListChecks, Pause, Play, RefreshCw,
  ShieldCheck, Siren, SlidersHorizontal, Wifi,
} from "lucide-react";
import AdminSecurityCenter from "@/components/admin-security-center";

/* Client-only: talks to /api/admin/security/* and never imports server modules. */

type Tab = "live" | "events" | "incidents" | "rules" | "sources";
type IncidentStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "FALSE_POSITIVE";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type Counters = { requests: number; status4xx: number; status5xx: number; authDenied: number; notFound: number; rateLimited: number; loginFailures: number; ipMismatches: number };
type Totals = Counters & { rate5xx: number; rate4xx: number; rateAuthDenied: number };
type LiveData = {
  generatedAt: string;
  series: Array<Counters & { minute: string }>;
  totals: { last60: Totals; last5: Totals };
  routeGroups: Array<{ routeGroup: string; requests: number; status4xx: number; status5xx: number; authDenied: number; notFound: number; rateLimited: number; avgMs: number | null; maxMs: number }>;
  latestStatMinute: string | null;
  recentEvents: Array<{ id: string; occurredAt: string; source: string; eventType: string; severity: Severity; action: string; path: string | null; ip: string | null }>;
  openIncidents: Array<{ id: string; ruleKey: string; title: string; severity: Severity; status: IncidentStatus; observedValue: number; threshold: number; createdAt: string; assignee: string | null }>;
  incidentCounts: Record<IncidentStatus, number>;
  sources: Record<"application" | "cloudflare" | "apache", { state: "active" | "relay" | "not_in_use"; eventsLast24h: number; lastReceivedAt: string | null }>;
  telemetry: { flushIntervalSeconds: number; processLastFlushAt: string | null };
};
type Incident = {
  id: string; ruleKey: string; title: string; severity: Severity; status: IncidentStatus; observedValue: number; threshold: number; windowMinutes: number;
  windowStart: string; windowEnd: string; acknowledgedAt: string | null; resolvedAt: string | null; createdAt: string; updatedAt: string;
  assigneeId: string | null; assignee: string | null; acknowledgedBy: string | null; resolvedBy: string | null; noteCount: number; allowedTransitions: IncidentStatus[];
  notes?: Array<{ id: string; body: string; createdAt: string; author: string }>;
};
type RuleSettings = { enabled: boolean; threshold: number; windowMinutes: number; cooldownMinutes: number };
type Rule = { key: string; label: string; description: string; severity: Severity; defaults: RuleSettings; settings: RuleSettings; isDefault: boolean; version: number; updatedAt: string | null; updatedBy: string | null };
type Bounds = { threshold: [number, number]; windowMinutes: [number, number]; cooldownMinutes: [number, number] };

export const LIVE_POLL_MS = 15_000;

const TABS: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: "live", label: "Canlı", icon: Gauge },
  { id: "events", label: "Hadisələr", icon: Activity },
  { id: "incidents", label: "İnsidentlər", icon: Siren },
  { id: "rules", label: "Qaydalar", icon: SlidersHorizontal },
  { id: "sources", label: "Mənbələr", icon: Wifi },
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
const ROUTE_GROUP_LABELS: Record<string, string> = {
  "auth.login": "Müştəri girişi",
  "auth.vendor-login": "Satıcı girişi",
  "admin.login": "Admin girişi",
  "admin.2fa": "Admin 2FA",
  "auth.register": "Qeydiyyat",
  "auth.password-reset": "Şifrə bərpası",
  "seller-application": "Satıcı müraciəti",
  inquiry: "Mağaza sorğusu",
  "security.ingest": "Hadisə qəbulu",
  "admin.security": "Təhlükəsizlik mərkəzi",
  "notfound.php": "404 · PHP skanı",
  "notfound.wp": "404 · WordPress skanı",
  "notfound.secrets": "404 · gizli fayl axtarışı",
  "notfound.admin-probe": "404 · admin panel axtarışı",
  "notfound.api": "404 · API",
  "notfound.other": "404 · digər",
  other: "Digər",
};
const EVENT_TYPE_LABELS: Record<string, string> = {
  LOGIN_FAILURE: "Uğursuz giriş",
  RATE_LIMIT_VIOLATION: "Limit aşımı",
  IP_HEADER_MISMATCH: "IP başlıqları uyğun gəlmir",
  SUSPICIOUS_PATH: "Şübhəli yol",
  ABUSIVE_API: "API sui-istifadəsi",
  WAF_EVENT: "WAF hadisəsi",
};

const panelClass = "rounded-xl border border-slate-700 bg-slate-900 p-4 sm:p-5";
const inputClass = "min-h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-900";
const buttonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

const time = (value: string | null) => (value ? new Intl.DateTimeFormat("az-AZ", { timeZone: "Asia/Baku", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)) : "—");
const dateTime = (value: string | null) => (value ? new Intl.DateTimeFormat("az-AZ", { timeZone: "Asia/Baku", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—");
const number = (value: number) => new Intl.NumberFormat("az-AZ").format(value);
const groupLabel = (group: string) => ROUTE_GROUP_LABELS[group] ?? group;

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
  const [tab, setTab] = useState<Tab>("live");
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
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.2em] text-emerald-300"><ShieldCheck size={15} aria-hidden="true" /> BAGATI · Təhlükəsizlik mərkəzi</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Canlı təhlükəsizlik monitorinqi</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">Tətbiqin öz sayğacları və qeydə alınmış hadisələr. Xəbərdarlıqlar yalnız bu paneldə göstərilir; IP bloklaması yoxdur.</p>
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
      {tab === "events" ? <AdminSecurityCenter /> : (
        <div className="p-4 sm:p-6 lg:px-8">
          {tab === "live" && <LivePanel onOpenIncidents={() => select("incidents")} />}
          {tab === "incidents" && <IncidentsPanel />}
          {tab === "rules" && <RulesPanel />}
          {tab === "sources" && <SourcesPanel />}
        </div>
      )}
    </main>
  );
}

function useLiveData(enabled: boolean) {
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    try {
      setData(await requestJson<LiveData>("/api/admin/security/live", { signal: controller.signal }));
      setError(null);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Sorğu alınmadı.");
    } finally {
      if (inFlight.current === controller) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    if (!enabled) return () => inFlight.current?.abort();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, LIVE_POLL_MS);
    return () => { window.clearInterval(timer); inFlight.current?.abort(); };
  }, [enabled, load]);
  return { data, error, loading, load };
}

function LivePanel({ onOpenIncidents }: { onOpenIncidents: () => void }) {
  const [paused, setPaused] = useState(false);
  const { data, error, loading, load } = useLiveData(!paused);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge className={paused ? "border-slate-600 text-slate-300" : "border-emerald-800 bg-emerald-950/50 text-emerald-200"}>
          <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${paused ? "bg-slate-500" : "animate-pulse bg-emerald-400"}`} aria-hidden="true" />
          {paused ? "Dayandırılıb" : "Canlı · hər 15 saniyədə"}
        </Badge>
        <span className="text-slate-400">Son yenilənmə: {time(data?.generatedAt ?? null)}</span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setPaused((value) => !value)} className={`${buttonClass} border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800`}>
            {paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />} {paused ? "Davam et" : "Dayandır"}
          </button>
          <button type="button" onClick={() => void load()} disabled={loading} className={`${buttonClass} border-emerald-700 bg-emerald-950/40 text-emerald-100 hover:bg-emerald-900/50`}>
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} aria-hidden="true" /> Yenilə
          </button>
        </div>
      </div>
      <ErrorBox message={error ? `${error}${data ? " Ekrandakı məlumat son uğurlu cavaba aiddir." : ""}` : null} />
      {!data ? (
        <p role="status" className={`${panelClass} text-sm text-slate-300`}>{loading ? "Canlı məlumat yüklənir…" : "Məlumat yoxdur."}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Sorğular" value={number(data.totals.last5.requests)} hint={`60 dəq: ${number(data.totals.last60.requests)}`} />
            <Metric label="5xx xəta dərəcəsi" value={`${data.totals.last5.rate5xx}%`} hint={`60 dəq: ${data.totals.last60.rate5xx}% · ${number(data.totals.last60.status5xx)}`} tone={data.totals.last5.status5xx > 0 ? "bad" : "ok"} />
            <Metric label="401/403" value={number(data.totals.last5.authDenied)} hint={`60 dəq: ${number(data.totals.last60.authDenied)} · ${data.totals.last60.rateAuthDenied}%`} tone={data.totals.last5.authDenied > 0 ? "warn" : "ok"} />
            <Metric label="404" value={number(data.totals.last5.notFound)} hint={`60 dəq: ${number(data.totals.last60.notFound)}`} tone={data.totals.last5.notFound > 20 ? "warn" : "ok"} />
            <Metric label="429 (limit)" value={number(data.totals.last5.rateLimited)} hint={`60 dəq: ${number(data.totals.last60.rateLimited)}`} tone={data.totals.last5.rateLimited > 0 ? "warn" : "ok"} />
            <Metric label="Uğursuz girişlər" value={number(data.totals.last5.loginFailures)} hint={`60 dəq: ${number(data.totals.last60.loginFailures)}`} tone={data.totals.last5.loginFailures > 0 ? "warn" : "ok"} />
            <Metric label="IP başlıq uyğunsuzluğu" value={number(data.totals.last5.ipMismatches)} hint={`60 dəq: ${number(data.totals.last60.ipMismatches)}`} tone={data.totals.last60.ipMismatches > 0 ? "bad" : "ok"} />
            <Metric label="Açıq insidentlər" value={number(data.incidentCounts.OPEN + data.incidentCounts.ACKNOWLEDGED)} hint={`Açıq ${data.incidentCounts.OPEN} · qəbul edilib ${data.incidentCounts.ACKNOWLEDGED}`} tone={data.incidentCounts.OPEN > 0 ? "bad" : "ok"} />
          </div>
          <p className="text-[11px] text-slate-500">Böyük rəqəm son 5 dəqiqəni göstərir. Sayğaclar hər prosesdə {data.telemetry.flushIntervalSeconds} saniyədən bir bazaya yazılır; son dəqiqə natamam ola bilər.</p>

          <section className={panelClass} aria-labelledby="rpm-title">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="rpm-title" className="text-sm font-semibold text-white">Dəqiqədə sorğular · son 60 dəqiqə</h2>
              <div className="flex gap-3 text-[11px] text-slate-400">
                <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-sky-500" aria-hidden="true" /> uğurlu</span>
                <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-amber-400" aria-hidden="true" /> 4xx</span>
                <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-rose-500" aria-hidden="true" /> 5xx</span>
              </div>
            </div>
            <RequestsChart series={data.series} />
          </section>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <section className={panelClass} aria-labelledby="groups-title">
              <h2 id="groups-title" className="text-sm font-semibold text-white">Ən aktiv marşrut qrupları · 60 dəq</h2>
              {data.routeGroups.length === 0 ? <p className="mt-3 text-sm text-slate-400">Son 60 dəqiqədə izlənən sorğu yoxdur.</p> : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[26rem] text-left text-xs">
                    <thead className="text-slate-500"><tr><th className="py-2 pr-2 font-medium">Qrup</th><th className="px-2 text-right font-medium">Sorğu</th><th className="px-2 text-right font-medium">4xx</th><th className="px-2 text-right font-medium">5xx</th><th className="px-2 text-right font-medium">401/403</th><th className="px-2 text-right font-medium">429</th><th className="pl-2 text-right font-medium">Orta ms</th></tr></thead>
                    <tbody className="divide-y divide-slate-800">
                      {data.routeGroups.map((row) => (
                        <tr key={row.routeGroup}>
                          <td className="py-2 pr-2 text-slate-200">{groupLabel(row.routeGroup)}</td>
                          <td className="px-2 text-right tabular-nums text-slate-200">{number(row.requests)}</td>
                          <td className="px-2 text-right tabular-nums text-amber-200">{number(row.status4xx)}</td>
                          <td className="px-2 text-right tabular-nums text-rose-200">{number(row.status5xx)}</td>
                          <td className="px-2 text-right tabular-nums text-slate-300">{number(row.authDenied)}</td>
                          <td className="px-2 text-right tabular-nums text-slate-300">{number(row.rateLimited)}</td>
                          <td className="pl-2 text-right tabular-nums text-slate-400">{row.avgMs ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={panelClass} aria-labelledby="open-title">
              <div className="flex items-center justify-between gap-2">
                <h2 id="open-title" className="text-sm font-semibold text-white">Açıq insidentlər</h2>
                <button type="button" onClick={onOpenIncidents} className="text-xs font-medium text-emerald-300 underline">Hamısı</button>
              </div>
              {data.openIncidents.length === 0 ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-emerald-200"><CheckCircle2 size={16} aria-hidden="true" /> Açıq insident yoxdur.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {data.openIncidents.map((incident) => (
                    <li key={incident.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={SEVERITY_CLASSES[incident.severity]}>{SEVERITY_LABELS[incident.severity]}</Badge>
                        <Badge className={STATUS_CLASSES[incident.status]}>{STATUS_LABELS[incident.status]}</Badge>
                        <span className="text-[11px] text-slate-500">{dateTime(incident.createdAt)}</span>
                      </div>
                      <p className="mt-1.5 text-sm text-slate-100">{incident.title}</p>
                      {incident.assignee && <p className="mt-1 text-[11px] text-slate-400">Məsul: {incident.assignee}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className={panelClass} aria-labelledby="recent-title">
            <h2 id="recent-title" className="text-sm font-semibold text-white">Son hadisələr</h2>
            {data.recentEvents.length === 0 ? <p className="mt-3 text-sm text-slate-400">Qeydə alınmış hadisə yoxdur.</p> : (
              <ul className="mt-3 divide-y divide-slate-800">
                {data.recentEvents.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs">
                    <span className="w-16 shrink-0 tabular-nums text-slate-500">{time(event.occurredAt)}</span>
                    <Badge className={SEVERITY_CLASSES[event.severity]}>{SEVERITY_LABELS[event.severity]}</Badge>
                    <span className="text-slate-200">{EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}</span>
                    <span className="font-mono text-slate-400">{event.ip ?? "IP yoxdur"}</span>
                    <span className="min-w-0 max-w-full truncate font-mono text-slate-500 sm:ml-auto sm:max-w-[16rem]">{event.path ?? ""}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-slate-500">IP ünvanları maskalanıb. Tam IP 7 gün saxlanılır, sonra yalnız maskalı forma qalır.</p>
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, hint, tone = "ok" }: { label: string; value: string; hint: string; tone?: "ok" | "warn" | "bad" }) {
  const toneClass = tone === "bad" ? "text-rose-200" : tone === "warn" ? "text-amber-200" : "text-white";
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-3 sm:p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}

function RequestsChart({ series }: { series: LiveData["series"] }) {
  const width = 600;
  const height = 160;
  const max = Math.max(1, ...series.map((point) => point.requests));
  const slot = width / Math.max(series.length, 1);
  const barWidth = Math.max(1, slot - 2);
  const y = (value: number) => (value / max) * (height - 4);
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-label={`Son 60 dəqiqədə dəqiqəlik sorğular, ən çox ${max}`} preserveAspectRatio="none">
        <line x1="0" x2={width} y1={height} y2={height} className="stroke-slate-700" strokeWidth="1" />
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} className="stroke-slate-800" strokeDasharray="4 4" strokeWidth="1" />
        {series.map((point, index) => {
          const ok = Math.max(0, point.requests - point.status4xx - point.status5xx);
          const x = index * slot + 1;
          const h5 = y(point.status5xx);
          const h4 = y(point.status4xx);
          const hOk = y(ok);
          return (
            <g key={point.minute}>
              <title>{`${time(point.minute)} · ${point.requests} sorğu · 4xx ${point.status4xx} · 5xx ${point.status5xx}`}</title>
              {h5 > 0 && <rect x={x} y={height - h5} width={barWidth} height={h5} className="fill-rose-500" />}
              {h4 > 0 && <rect x={x} y={height - h5 - h4} width={barWidth} height={h4} className="fill-amber-400" />}
              {hOk > 0 && <rect x={x} y={height - h5 - h4 - hOk} width={barWidth} height={hOk} className="fill-sky-500" />}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[11px] text-slate-500" aria-hidden="true"><span>-60 dəq</span><span>-30 dəq</span><span>indi</span></div>
      <figcaption className="mt-1 text-[11px] text-slate-500">Şkalanın yuxarısı: {number(max)} sorğu/dəq. Sütunun üzərinə gətirəndə dəqiqənin rəqəmləri görünür.</figcaption>
    </figure>
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

function SourcesPanel() {
  const { data, error } = useLiveData(false);
  const rows: Array<{ key: "application" | "cloudflare" | "apache"; title: string; text: string }> = [
    { key: "application", title: "BAGATI tətbiqi", text: "Giriş, 2FA, qeydiyyat, şifrə bərpası, satıcı müraciəti və mağaza sorğusu marşrutları, həmçinin 404 səhifəsi tətbiqin öz sayğacları ilə izlənir." },
    { key: "cloudflare", title: "Cloudflare (imzalı ötürücü)", text: "Yalnız imzalı ötürücü ilə göndərilən hadisələr. Birbaşa Cloudflare API inteqrasiyası bu mərhələdə yoxdur." },
    { key: "apache", title: "Apache / ModSecurity", text: "Bu quraşdırmada istifadə olunmur. Qəbul kodu saxlanılıb, lakin agent qoşulmayıb." },
  ];
  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <article className={panelClass}>
          <h3 className="flex items-center gap-2 font-semibold text-white"><Gauge size={17} className="text-emerald-300" aria-hidden="true" /> Tətbiq telemetriyası</h3>
          <p className="mt-2 text-xs leading-5 text-slate-400">Sayğaclar yaddaşda toplanır və hər {data?.telemetry.flushIntervalSeconds ?? 30} saniyədə bazaya yazılır. Ayrı işçi proses yoxdur; qaydalar və təmizləmə tətbiqin içində işləyir.</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <dt className="text-slate-500">Bazadakı son dəqiqə</dt><dd className="text-slate-200">{data ? time(data.latestStatMinute) : "—"}</dd>
            <dt className="text-slate-500">Bu prosesin son yazısı</dt><dd className="text-slate-200">{data ? time(data.telemetry.processLastFlushAt) : "—"}</dd>
            <dt className="text-slate-500">Saxlama</dt><dd className="text-slate-200">IP 7 gün · dəqiqəlik 14 gün · saatlıq 90 gün</dd>
          </dl>
        </article>
        {rows.map((row) => {
          const source = data?.sources[row.key];
          const notInUse = row.key === "apache";
          return (
            <article key={row.key} className={panelClass}>
              <h3 className="flex flex-wrap items-center gap-2 font-semibold text-white">
                <Wifi size={17} className={notInUse ? "text-slate-500" : "text-sky-300"} aria-hidden="true" /> {row.title}
                <Badge className={notInUse ? "border-slate-600 bg-slate-800 text-slate-300" : "border-emerald-800 bg-emerald-950/40 text-emerald-200"}>{notInUse ? "istifadə olunmur" : row.key === "application" ? "aktiv" : "ötürücü"}</Badge>
              </h3>
              <p className="mt-2 text-xs leading-5 text-slate-400">{row.text}</p>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <dt className="text-slate-500">Son 24 saat hadisə</dt><dd className="text-slate-200">{source ? number(source.eventsLast24h) : "—"}</dd>
                <dt className="text-slate-500">Son qəbul</dt><dd className="text-slate-200">{source ? dateTime(source.lastReceivedAt) : "—"}</dd>
              </dl>
            </article>
          );
        })}
      </div>
    </div>
  );
}
