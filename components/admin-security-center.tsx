"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  CircleHelp,
  Clock3,
  Database,
  Filter,
  Globe2,
  LockKeyhole,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Siren,
  ScrollText,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  SECURITY_EVENT_ACTIONS,
  SECURITY_EVENT_SEVERITIES,
  SECURITY_EVENT_SOURCES,
  SECURITY_EVENT_TYPES,
  SECURITY_EVENT_WINDOWS,
} from "@/lib/security-event-types";

type SecurityEvent = {
  id: string;
  sourceEventId: string;
  occurredAt: string;
  receivedAt: string;
  source: string;
  sourceIp: string | null;
  path: string | null;
  eventType: string;
  severity: string;
  action: string;
  ruleId: string | null;
};

type TimelineBucket = { index: number; count: number; critical: number; high: number };
type RepeatedIp = {
  sourceIp: string;
  count: number;
  latestAt: string;
  sources: string[];
  eventTypes: string[];
  critical: number;
  high: number;
};

type DistributionItem = { [key: string]: string | number; count: number };
type SourceActivity = {
  producer?: string;
  instrumentedEventTypes?: string[];
  directApiAdapter?: string;
  relaySecretConfigured?: boolean;
  receiverConfigured?: boolean;
  lastReceivedAt: string | null;
  lastOccurredAt: string | null;
  eventsInWindow: number;
  eventsLast15Minutes: number;
};

type SecurityData = {
  generatedAt: string;
  summary: {
    window: (typeof SECURITY_EVENT_WINDOWS)[number];
    windowStart: string;
    windowEnd: string;
    total: number;
    severity: Record<string, number>;
    sources: Array<{ source: string; count: number }>;
    actions: Array<{ action: string; count: number }>;
    eventTypes: Array<{ eventType: string; count: number }>;
    latestEventAt: string | null;
    repeatedLoginSourcesLast15Minutes: number;
    previousWindowStart: string;
    previousWindowEnd: string;
    previousWindowTotal: number;
    windowChange: number;
  };
  events: SecurityEvent[];
  timeline: TimelineBucket[];
  repeatedIps: RepeatedIp[];
  priorityEvents: SecurityEvent[];
  page: number;
  pageSize: number;
  totalFiltered: number;
  integrations: {
    application: SourceActivity;
    cloudflare: SourceActivity;
    apache: SourceActivity;
  };
  coverage: {
    applicationInstrumentedEventTypes: string[];
    applicationEventCounts: Array<{ eventType: string; count: number }>;
    applicationNotInstrumentedEventTypes: string[];
    apacheStoredFields: string[];
    apacheMessageStored: boolean;
    cloudflareDirectIntegration: string;
    ipBlocking: string;
  };
  services: { eventStoreRead: string; checkedAt: string };
};

const sourceLabel: Record<string, string> = {
  APPLICATION: "BAGATI tətbiqi",
  CLOUDFLARE: "Cloudflare / imzalı ötürücü",
  APACHE_MODSECURITY: "Apache / ModSecurity",
};
const severityLabel: Record<string, string> = {
  CRITICAL: "Kritik",
  HIGH: "Yüksək",
  MEDIUM: "Orta",
  LOW: "Aşağı",
};
const eventLabel: Record<string, string> = {
  LOGIN_FAILURE: "Uğursuz giriş",
  RATE_LIMIT_VIOLATION: "Sorğu limiti aşılıb",
  SUSPICIOUS_PATH: "Şübhəli URL yolu",
  ABUSIVE_API: "API istifadəsi qaydası",
  WAF_EVENT: "WAF hadisəsi",
  MODSECURITY_EVENT: "ModSecurity hadisəsi",
};
const actionLabel: Record<string, string> = {
  OBSERVED: "Müşahidə edilib",
  DENIED: "Sorğu rədd edilib",
  CHALLENGED: "Yoxlama tələb edilib",
  BLOCKED: "Hadisədə bloklanıb",
  ALLOWED: "İcazə verilib",
};
const severityStyle: Record<string, string> = {
  CRITICAL: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  HIGH: "border-orange-300/30 bg-orange-300/10 text-orange-100",
  MEDIUM: "border-amber-300/30 bg-amber-300/10 text-amber-100",
  LOW: "border-slate-400/30 bg-slate-400/10 text-slate-200",
};
const actionStyle: Record<string, string> = {
  OBSERVED: "text-sky-300",
  DENIED: "text-orange-200",
  CHALLENGED: "text-amber-200",
  BLOCKED: "text-rose-200",
  ALLOWED: "text-emerald-200",
};
const inputClass =
  "min-h-10 w-full rounded-lg border border-slate-600 bg-slate-950/80 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20";
const panelClass = "rounded-xl border border-slate-700 bg-slate-900 p-4 sm:p-5";
const timeWindowLabels: Record<string, string> = {
  "1h": "Son 1 saat",
  "24h": "Son 24 saat",
  "7d": "Son 7 gün",
  "30d": "Son 30 gün",
};

const navigationItems = [
  { href: "#overview", label: "Ümumi baxış", icon: Shield },
  { href: "#live-events", label: "Təhlükəsizlik hadisələri", icon: Activity },
  { href: "#suspicious-traffic", label: "Şübhəli trafik", icon: Globe2 },
  { href: "#incidents", label: "İnsidentlər", icon: Siren },
  { href: "#analysis", label: "Təhlükə təhlili", icon: BarChart3 },
  { href: "#ip-management", label: "IP idarəetməsi", icon: Ban },
  { href: "#sources", label: "Mənbələr və sistem sağlamlığı", icon: Wifi },
  { href: "/admin/audit-log", label: "Audit jurnalı", icon: ScrollText },
];

function formatDate(value: string | null) {
  if (!value) return "Qeyd yoxdur";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Vaxt məlum deyil";
  return new Intl.DateTimeFormat("az-AZ", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ageLabel(value: string | null, now: string) {
  if (!value) return "Qeyd yoxdur";
  const seconds = Math.max(0, Math.floor((new Date(now).getTime() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "1 dəqiqədən az əvvəl";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} dəqiqə əvvəl`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} saat əvvəl`;
  return `${Math.floor(seconds / 86400)} gün əvvəl`;
}

function sourceStatus(source: SourceActivity, now: string) {
  if (!source.lastReceivedAt) return "no-events";
  const ageMs = new Date(now).getTime() - new Date(source.lastReceivedAt).getTime();
  if (source.eventsLast15Minutes > 0) return "recent";
  if (ageMs > 24 * 60 * 60 * 1000) return "stale";
  return "quiet";
}

function Distribution({
  title,
  items,
  getLabel,
  tone = "bg-emerald-400",
}: {
  title: string;
  items: DistributionItem[];
  getLabel: (item: DistributionItem) => string;
  tone?: string;
}) {
  const maximum = Math.max(1, ...items.map((item) => item.count));
  return (
    <section className={panelClass}>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">Seçilmiş müddətdə hadisə qeydə alınmayıb.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={getLabel(item)}>
              <div className="mb-1 flex justify-between gap-3 text-xs">
                <span className="truncate text-slate-300">{getLabel(item)}</span>
                <span className="shrink-0 font-mono text-slate-400">{item.count}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full ${tone}`}
                  style={{ width: `${Math.max(3, (item.count / maximum) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Freshness({
  source,
  now,
  configuration,
}: {
  source: SourceActivity;
  now: string;
  configuration: "configured" | "unconfigured" | "not-implemented";
}) {
  const status = sourceStatus(source, now);
  const statusLabel = configuration === "not-implemented"
    ? "İzləmə qurulmayıb"
    : !source.lastReceivedAt && configuration === "unconfigured"
      ? "Qoşulmayıb"
      : status === "recent"
        ? "Son məlumat yeni"
        : status === "stale"
          ? "Son məlumat köhnədir"
          : status === "quiet"
            ? "Yaxın zamanda hadisə qeydə alınmayıb"
            : "Bu müddətdə qeydə alınmış hadisə yoxdur";
  const Icon = status === "recent" ? CheckCircle2 : status === "no-events" ? CircleHelp : Clock3;
  const color = configuration === "not-implemented"
    ? "text-amber-200"
    : !source.lastReceivedAt && configuration === "unconfigured"
      ? "text-slate-400"
      : status === "recent"
        ? "text-emerald-300"
        : status === "stale"
          ? "text-amber-200"
          : "text-slate-300";
  return (
    <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/60 p-3">
      <p className={`flex items-center gap-2 text-xs font-medium ${color}`}>
        <Icon aria-hidden="true" size={15} />
        {statusLabel}
      </p>
      <p className="mt-1 text-xs text-slate-400">
        Son qəbul edilmiş qeyd: {source.lastReceivedAt ? `${formatDate(source.lastReceivedAt)} (${ageLabel(source.lastReceivedAt, now)})` : "yoxdur"}
      </p>
      {source.lastOccurredAt && source.lastOccurredAt !== source.lastReceivedAt && (
        <p className="mt-1 text-xs text-slate-500">Son hadisənin vaxtı: {formatDate(source.lastOccurredAt)}</p>
      )}
      <p className="mt-1 text-[11px] text-slate-500">
        Son hadisə göndərişi cari və fasiləsiz əlaqəni təsdiqləmir.
      </p>
    </div>
  );
}

function TimelineChart({
  buckets,
  start,
  end,
  selectedWindow,
}: {
  buckets: TimelineBucket[];
  start: string;
  end: string;
  selectedWindow: (typeof SECURITY_EVENT_WINDOWS)[number];
}) {
  if (buckets.length === 0 || buckets.every((bucket) => bucket.count === 0)) {
    return (
      <div className="mt-4 flex min-h-36 items-center justify-center rounded-lg border border-dashed border-slate-700 text-sm text-slate-400">
        Bu müddətdə qeydə alınmış hadisə yoxdur.
      </div>
    );
  }
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const width = 720;
  const height = 172;
  const gap = 5;
  const barWidth = (width - gap * (buckets.length - 1)) / buckets.length;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const bucketDuration = (endMs - startMs) / buckets.length;
  const dateLabel = (index: number) => {
    const value = new Date(startMs + index * bucketDuration);
    return selectedWindow === "1h" || selectedWindow === "24h"
      ? value.toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit" })
      : value.toLocaleDateString("az-AZ", { day: "2-digit", month: "2-digit" });
  };
  return (
    <div className="mt-4 overflow-hidden">
      <div className="mb-2 flex gap-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-emerald-400" /> Bütün qeydlər</span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-sm bg-rose-400" /> Kritik / yüksək</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${timeWindowLabels[selectedWindow]} üzrə verilənlər bazasında saxlanmış hadisələrin zaman bölgüsü`}
        className="h-40 w-full"
        preserveAspectRatio="none"
      >
        {[0, 0.5, 1].map((fraction) => (
          <line
            key={fraction}
            x1="0"
            x2={width}
            y1={height - fraction * (height - 12)}
            y2={height - fraction * (height - 12)}
            stroke="#243447"
            strokeDasharray="3 5"
          />
        ))}
        {buckets.map((bucket) => {
          const x = bucket.index * (barWidth + gap);
          const barHeight = Math.max(2, (bucket.count / maxCount) * (height - 20));
          const priorityCount = bucket.critical + bucket.high;
          const priorityHeight = bucket.count
            ? (priorityCount / bucket.count) * barHeight
            : 0;
          return (
            <g key={bucket.index}>
              <rect
                x={x}
                y={height - barHeight}
                width={barWidth}
                height={barHeight}
                rx="3"
                fill="#34d399"
                opacity={bucket.count ? 0.78 : 0.18}
              >
                <title>{`${dateLabel(bucket.index)} · ${bucket.count} hadisə`}</title>
              </rect>
              {priorityHeight > 0 && (
                <rect
                  x={x}
                  y={height - priorityHeight}
                  width={barWidth}
                  height={priorityHeight}
                  rx="3"
                  fill="#fb7185"
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>{formatDate(start)}</span>
        <span>{formatDate(end)}</span>
      </div>
    </div>
  );
}

export default function AdminSecurityCenter() {
  const [data, setData] = useState<SecurityData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [source, setSource] = useState("");
  const [severity, setSeverity] = useState("");
  const [eventType, setEventType] = useState("");
  const [action, setAction] = useState("");
  const [selectedWindow, setSelectedWindow] = useState<(typeof SECURITY_EVENT_WINDOWS)[number]>("24h");
  const [page, setPage] = useState(1);
  const [selectedEvent, setSelectedEvent] = useState<SecurityEvent | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!selectedEvent) return;
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    const closeButton = dialog?.querySelector<HTMLButtonElement>("button[aria-label]");
    closeButton?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedEvent(null);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [selectedEvent]);

  const load = useCallback(async (signal?: AbortSignal, background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError("");
    const params = new URLSearchParams({ window: selectedWindow, page: String(page) });
    if (submittedSearch) params.set("q", submittedSearch);
    if (source) params.set("source", source);
    if (severity) params.set("severity", severity);
    if (eventType) params.set("eventType", eventType);
    if (action) params.set("action", action);
    try {
      const response = await fetch(`/api/admin/security/events?${params}`, {
        cache: "no-store",
        signal,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(typeof result?.error === "string" ? result.error : "Təhlükəsizlik məlumatları yüklənmədi.");
      }
      setData(result as SecurityData);
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Təhlükəsizlik məlumatları yüklənmədi.");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [action, eventType, page, selectedWindow, severity, source, submittedSearch]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => void load(undefined, true), 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.totalFiltered / data.pageSize)) : 1;
  const asOf = data?.generatedAt ?? new Date().toISOString();
  const actions = useMemo(
    () => Object.fromEntries((data?.summary.actions ?? []).map((item) => [item.action, item.count])),
    [data?.summary.actions],
  );

  function resetPageAnd(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  return (
    <main className="min-h-screen rounded-2xl bg-[#07111b] p-4 text-slate-100 sm:p-6 lg:p-8">
      <header className="flex flex-col justify-between gap-5 border-b border-slate-800 pb-6 lg:flex-row lg:items-end">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.2em] text-emerald-300">
            <ShieldCheck size={15} aria-hidden="true" /> BAGATI · Təhlükəsizlik əməliyyatları mərkəzi
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">Təhlükəsizlik mərkəzi</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Yalnız həqiqətən qəbul edilərək saxlanmış qeydlər. Nümunə məlumat, uydurma hücum və aktiv IP bloklaması yoxdur.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs text-slate-400" htmlFor="security-window">Müddət</label>
          <select
            id="security-window"
            className={`${inputClass} w-auto min-w-36`}
            value={selectedWindow}
            onChange={(event) => {
              setSelectedWindow(event.target.value as (typeof SECURITY_EVENT_WINDOWS)[number]);
              setPage(1);
            }}
          >
            {SECURITY_EVENT_WINDOWS.map((item) => <option key={item} value={item}>{timeWindowLabels[item]}</option>)}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || refreshing}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-700 bg-emerald-950/40 px-4 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-900/50 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
            {refreshing ? "Yenilənir" : "Yenilə"}
          </button>
        </div>
      </header>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-300">
          <Database size={13} aria-hidden="true" />
          {data ? `Məlumat yeniləndi: ${formatDate(data.generatedAt)}` : loading ? "Məlumat yüklənir" : "Məlumat almaq mümkün olmadı"}
        </span>
        <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-400">Avtomatik yenilənmə: 30 saniyə</span>
        {data && (
          <>
            <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-300">
              Apache: {data.integrations.apache.receiverConfigured ? "Qəbul sazlanıb" : "Qəbul sazlanmayıb"}
            </span>
            <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-300">
              Cloudflare: {data.integrations.cloudflare.directApiAdapter === "not_implemented" ? "İzləmə qurulmayıb" : "Məlumat yoxdur"}
            </span>
          </>
        )}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-5 lg:self-start">
          <nav aria-label="Təhlükəsizlik mərkəzi naviqasiyası" className="rounded-xl border border-slate-700 bg-slate-900 p-2">
            <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[.18em] text-slate-500">İş sahəsi</p>
            <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
              {navigationItems.map(({ href, label, icon: Icon }, index) => (
                <li key={href}>
                  <a
                    href={href}
                    aria-current={index === 0 ? "page" : undefined}
                    className={`flex min-h-10 items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-xs transition ${
                      index === 0
                        ? "bg-emerald-950/70 font-semibold text-emerald-200 ring-1 ring-emerald-800"
                        : "text-slate-400 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    <Icon size={15} aria-hidden="true" />
                    {label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-3 hidden rounded-lg border border-slate-800 bg-slate-950/70 p-3 lg:block">
              <p className="flex items-center gap-2 text-xs font-medium text-slate-200"><CircleDot size={13} className="text-emerald-300" aria-hidden="true" /> Təhlükəsiz müşahidə</p>
              <p className="mt-2 text-[11px] leading-4 text-slate-500">Panel yalnız qəbul edilərək bazada saxlanmış qeydləri göstərir.</p>
            </div>
          </nav>
        </aside>

        <div className="min-w-0">
      {error && (
        <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl border border-rose-800 bg-rose-950/60 p-4 text-sm text-rose-100">
          <AlertCircle className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
          <div>
            <p className="font-semibold">Məlumat sorğusu alınmadı</p>
            <p className="mt-1 text-rose-200">{error}</p>
            <p className="mt-1 text-xs text-rose-300">Nəticələr uğursuz sorğu üçün sıfır kimi göstərilmir; yenidən yoxlayın.</p>
            {data && <p className="mt-1 text-xs text-rose-300">Ekrandakı məlumat son uğurlu cavaba aiddir: {formatDate(data.generatedAt)}.</p>}
          </div>
        </div>
      )}

      {loading && !data && (
        <p role="status" className="mt-5 rounded-xl border border-slate-700 bg-slate-900 p-5 text-sm text-slate-300">
          Təhlükəsizlik məlumatları bazadan yüklənir…
        </p>
      )}
      {loading && data && (
        <p role="status" className="mt-5 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-xs text-slate-300">
          Sorğu yenilənir; cavab gələnədək göstərilənlər son uğurlu yükləmədir ({formatDate(data.generatedAt)}).
        </p>
      )}

      {data && (
        <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0">
          <section id="overview" aria-labelledby="overview-title" className="mt-6 scroll-mt-6">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="overview-title" className="text-lg font-semibold text-white">İcmal</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {formatDate(data.summary.windowStart)} – {formatDate(data.summary.windowEnd)} · Son sorğu: {formatDate(data.generatedAt)}
                </p>
              </div>
              <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
                Məlumat bazası: cavab verdi
              </span>
            </div>

            {data.summary.total === 0 ? (
              <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
                <p className="flex items-center gap-2 font-medium text-slate-100"><Database size={17} aria-hidden="true" /> Seçilmiş müddətdə hadisə qeydə alınmayıb</p>
                <p className="mt-2 text-sm text-slate-400">
                  Sorğu uğurla tamamlandı və bazada bu müddət üçün hadisə tapılmadı. Bu, hadisələrin ümumiyyətlə baş vermədiyini və ya bütün mənbələrin qoşulduğunu göstərmir.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-emerald-700/50 bg-gradient-to-br from-emerald-950 to-slate-900 p-5">
                  <p className="text-xs uppercase tracking-wider text-emerald-200">Qeydə alınan hadisələr</p>
                  <p className="mt-2 text-3xl font-semibold tabular-nums text-white">{data.summary.total.toLocaleString("az-AZ")}</p>
                  <p className="mt-1 text-xs text-slate-400">{timeWindowLabels[data.summary.window]} · bazada saxlanmış qeydlər</p>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
                  <p className="text-xs uppercase tracking-wider text-slate-400">Ən son hadisə vaxtı</p>
                  <p className="mt-2 text-base font-semibold text-white">{formatDate(data.summary.latestEventAt)}</p>
                  <p className="mt-1 text-xs text-slate-400">Hadisə anı canlı bağlantı göstəricisi deyil.</p>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
                  <p className="text-xs uppercase tracking-wider text-slate-400">Sorğu rədd edilib</p>
                  <p className="mt-2 text-3xl font-semibold tabular-nums text-orange-100">{(actions.DENIED ?? 0).toLocaleString("az-AZ")}</p>
                  <p className="mt-1 text-xs text-slate-400">Yalnız real qeydlərdəki nəticə.</p>
                </div>
                <div className="rounded-xl border border-rose-800/60 bg-rose-950/30 p-5">
                  <p className="text-xs uppercase tracking-wider text-rose-200">IP bloklama inteqrasiyası</p>
                  <p className="mt-2 text-lg font-semibold text-white">Hazır deyil</p>
                  <p className="mt-1 text-xs text-slate-300">Bu panel trafikə IP qaydası tətbiq etmir.</p>
                </div>
              </div>
            )}

            {data.summary.total > 0 && (
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                <Distribution
                  title="Ciddilik bölgüsü · seçilmiş müddət"
                  items={Object.entries(data.summary.severity).map(([severity, count]) => ({ severity, count }))}
                  getLabel={(item) => severityLabel[String(item.severity)] ?? String(item.severity)}
                  tone="bg-amber-300"
                />
                <Distribution
                  title="Mənbə bölgüsü · seçilmiş müddət"
                  items={data.summary.sources.map((item) => ({ source: item.source, count: item.count }))}
                  getLabel={(item) => sourceLabel[String(item.source)] ?? String(item.source)}
                  tone="bg-sky-400"
                />
                <Distribution
                  title="Hadisə nəticələri · seçilmiş müddət"
                  items={data.summary.actions.map((item) => ({ action: item.action, count: item.count }))}
                  getLabel={(item) => actionLabel[String(item.action)] ?? String(item.action)}
                  tone="bg-rose-400"
                />
              </div>
            )}
            {data.summary.total > 0 && (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <Distribution
                  title="Hadisə növləri · seçilmiş müddət"
                  items={data.summary.eventTypes.map((item) => ({ eventType: item.eventType, count: item.count }))}
                  getLabel={(item) => eventLabel[String(item.eventType)] ?? String(item.eventType)}
                  tone="bg-violet-400"
                />
                <div className={panelClass}>
                  <h3 className="text-sm font-semibold text-white">Tətbiq siqnalları · son 15 dəqiqə</h3>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-white">
                    {data.summary.repeatedLoginSourcesLast15Minutes.toLocaleString("az-AZ")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Ən azı 5 uğursuz giriş qeydi olan fərqli IP sayı; yalnız mənbə IP-si saxlanmış hadisələr sayılır. Bu göstərici 15 dəqiqəlikdir və seçilmiş ümumi müddətdən ayrıdır.
                  </p>
                </div>
                <div className={panelClass}>
                  <h3 className="text-sm font-semibold text-white">Əvvəlki bərabər müddətlə müqayisə</h3>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-white">
                    {data.summary.windowChange > 0 ? "+" : ""}{data.summary.windowChange.toLocaleString("az-AZ")}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Cari müddət: {data.summary.total} hadisə. Əvvəlki müddət ({formatDate(data.summary.previousWindowStart)} – {formatDate(data.summary.previousWindowEnd)}): {data.summary.previousWindowTotal} hadisə.
                  </p>
                  {data.summary.previousWindowTotal === 0 && data.summary.total > 0 && (
                    <p className="mt-2 text-xs text-amber-200">Əvvəlki müddətdə qeyd yoxdur; faizlə artım hesablamaq mümkün deyil.</p>
                  )}
                  {data.summary.previousWindowTotal > 0 && (
                    <p className="mt-2 text-xs text-slate-500">Müqayisə eyni uzunluqlu iki məlumat bazası sorğusuna əsaslanır; artımın səbəbini təkbaşına müəyyən etmir.</p>
                  )}
                </div>
              </div>
            )}
          </section>

          <section id="analysis" aria-labelledby="analysis-title" className={`${panelClass} mt-5 scroll-mt-6`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="analysis-title" className="flex items-center gap-2 text-sm font-semibold text-white">
                  <BarChart3 size={17} className="text-emerald-300" aria-hidden="true" /> Hadisələrin zaman xətti
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Qruplaşdırma hadisənin baş vermə vaxtına əsaslanır; intervallar {timeWindowLabels[data.summary.window].toLowerCase()} üzrə məlumat bazası sorğusundan hesablanır.
                </p>
              </div>
              <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400">Avtomatik uydurma məlumat yoxdur</span>
            </div>
            <TimelineChart
              buckets={data.timeline}
              start={data.summary.windowStart}
              end={data.summary.windowEnd}
              selectedWindow={data.summary.window}
            />
          </section>

          <section id="live-events" aria-labelledby="events-title" className="mt-8 scroll-mt-6">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="events-title" className="text-lg font-semibold text-white">Təhlükəsizlik hadisələri</h2>
                <p className="mt-1 text-xs text-slate-400">Məlumat bazasına qəbul edilmiş qeydlər; siyahı hər 30 saniyədə yenilənir. Səhifədə ən çox 50 nəticə.</p>
              </div>
              {refreshing && <span role="status" className="text-xs text-emerald-200">Yenilənir…</span>}
            </div>

            <form
              className="mt-4 grid gap-2 rounded-xl border border-slate-700 bg-slate-900 p-3 sm:grid-cols-2 lg:grid-cols-6"
              onSubmit={(event) => {
                event.preventDefault();
                setSubmittedSearch(search.trim());
                setPage(1);
              }}
            >
              <label className="relative sm:col-span-2">
                <span className="sr-only">Hadisələrdə axtar</span>
                <Search className="pointer-events-none absolute left-3 top-3 text-slate-500" size={15} aria-hidden="true" />
                <input
                  className={`${inputClass} pl-9`}
                  placeholder="IP, yol, hadisə kodu və ya qayda"
                  value={search}
                  maxLength={100}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label>
                <span className="sr-only">Mənbəyə görə süzgəc</span>
                <select className={inputClass} value={source} onChange={(event) => resetPageAnd(setSource, event.target.value)}>
                  <option value="">Bütün mənbələr</option>
                  {SECURITY_EVENT_SOURCES.map((item) => <option key={item} value={item}>{sourceLabel[item]}</option>)}
                </select>
              </label>
              <label>
                <span className="sr-only">Ciddiliyə görə süzgəc</span>
                <select className={inputClass} value={severity} onChange={(event) => resetPageAnd(setSeverity, event.target.value)}>
                  <option value="">Bütün ciddiliklər</option>
                  {SECURITY_EVENT_SEVERITIES.map((item) => <option key={item} value={item}>{severityLabel[item]}</option>)}
                </select>
              </label>
              <label>
                <span className="sr-only">Hadisə növünə görə süzgəc</span>
                <select className={inputClass} value={eventType} onChange={(event) => resetPageAnd(setEventType, event.target.value)}>
                  <option value="">Bütün hadisə növləri</option>
                  {SECURITY_EVENT_TYPES.map((item) => <option key={item} value={item}>{eventLabel[item]}</option>)}
                </select>
              </label>
              <label>
                <span className="sr-only">Əməliyyata görə süzgəc</span>
                <select className={inputClass} value={action} onChange={(event) => resetPageAnd(setAction, event.target.value)}>
                  <option value="">Bütün nəticələr</option>
                  {SECURITY_EVENT_ACTIONS.map((item) => <option key={item} value={item}>{actionLabel[item]}</option>)}
                </select>
              </label>
              <button type="submit" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-600">
                <Filter size={15} aria-hidden="true" /> Tətbiq et
              </button>
            </form>

            {loading && (
              <p role="status" className="mt-3 rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300">Hadisələr yüklənir…</p>
            )}
            {!loading && !error && data.events.length === 0 && (
              <p className="mt-3 rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300">
                Bu müddət və süzgəclər üzrə hadisə tapılmadı. Mənbə qoşulmayıbsa, boş nəticə həmin mənbədən müşahidə olmadığını sübut etmir.
              </p>
            )}
            {data.events.length > 0 && (
              <div className="mt-3 overflow-x-auto rounded-xl border border-slate-700">
                <table className="w-full min-w-[1050px] text-left text-sm">
                  <caption className="sr-only">Saxlanmış təhlükəsizlik hadisələri və onların sahələri</caption>
                  <thead className="bg-slate-900 text-[11px] uppercase tracking-wide text-slate-400">
                    <tr>{["Başvermə vaxtı", "Qəbul vaxtı", "Mənbə", "IP ünvanı", "Sorğu yolu", "Hadisə növü", "Risk", "Nəticə", "Qayda", ""].map((label, index) => <th key={`${label}-${index}`} scope="col" className="px-3 py-3">{label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 bg-[#0b1723]">
                    {data.events.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-900/80">
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-300">{formatDate(item.occurredAt)}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-400">{formatDate(item.receivedAt)}</td>
                        <td className="px-3 py-3 text-xs text-slate-300">{sourceLabel[item.source] ?? item.source}</td>
                        <td className="px-3 py-3 font-mono text-xs text-slate-300">{item.sourceIp ?? "Təqdim edilməyib"}</td>
                        <td className="max-w-52 break-all px-3 py-3 font-mono text-xs text-slate-300">{item.path ?? "—"}</td>
                        <td className="px-3 py-3 text-xs text-slate-200">{eventLabel[item.eventType] ?? item.eventType}</td>
                        <td className="px-3 py-3">
                          <span className={`whitespace-nowrap rounded-full border px-2 py-1 text-[11px] ${severityStyle[item.severity] ?? severityStyle.LOW}`}>
                            {severityLabel[item.severity] ?? item.severity}
                          </span>
                        </td>
                        <td className={`whitespace-nowrap px-3 py-3 text-xs ${actionStyle[item.action] ?? "text-slate-300"}`}>{actionLabel[item.action] ?? item.action}</td>
                        <td className="px-3 py-3 font-mono text-xs text-slate-300">{item.ruleId ?? "—"}</td>
                        <td className="px-3 py-3">
                          <button type="button" onClick={() => setSelectedEvent(item)} className="whitespace-nowrap text-xs font-medium text-emerald-300 underline-offset-2 hover:underline">
                            Təfərrüat
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-slate-400">
                {data.totalFiltered === 0 ? "Uyğun hadisə yoxdur" : `${data.totalFiltered.toLocaleString("az-AZ")} uyğun qeyd · Səhifə ${page} / ${totalPages}`}
              </span>
              <div className="flex gap-2">
                <button type="button" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-700 px-3 text-slate-200 hover:bg-slate-800 disabled:opacity-40">
                  <ChevronLeft size={15} aria-hidden="true" /> Əvvəlki
                </button>
                <button type="button" disabled={loading || page >= totalPages} onClick={() => setPage((value) => value + 1)} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-700 px-3 text-slate-200 hover:bg-slate-800 disabled:opacity-40">
                  Növbəti <ChevronRight size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>

          <section id="suspicious-traffic" aria-labelledby="traffic-title" className={`${panelClass} mt-8 scroll-mt-6`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="traffic-title" className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Globe2 size={17} className="text-orange-200" aria-hidden="true" /> Eyni IP-dən təkrarlanan hadisələr
                </h2>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
                  Yalnız seçilmiş müddətdə ən azı iki hadisəsi olan, məlumat bazasında saxlanmış IP-lər qruplaşdırılır. Bu, araşdırma siqnalıdır; şəxsin hücumçu olduğunu müəyyən etmir.
                </p>
              </div>
              <span className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400">{timeWindowLabels[data.summary.window]}</span>
            </div>
            {data.repeatedIps.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
                Qiymətləndirmə üçün məlumat kifayət deyil: bu müddətdə təkrarlanan IP hadisəsi yoxdur və ya qeydlərdə IP saxlanmayıb.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full min-w-[740px] text-left text-xs">
                  <caption className="sr-only">Eyni IP ünvanından qeydə alınmış hadisələrin qrupları</caption>
                  <thead className="bg-slate-950 text-[10px] uppercase text-slate-500">
                    <tr>{["IP ünvanı", "Qeyd sayı", "Yüksək / kritik", "Mənbələr", "Hadisə növləri", "Son başvermə vaxtı", ""].map((label) => <th key={label} scope="col" className="px-3 py-3">{label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.repeatedIps.map((item) => (
                      <tr key={item.sourceIp}>
                        <td className="px-3 py-3 font-mono text-slate-200">{item.sourceIp}</td>
                        <td className="px-3 py-3 font-semibold tabular-nums text-white">{item.count}</td>
                        <td className="px-3 py-3 text-slate-300">{item.high + item.critical} ({item.critical} kritik, {item.high} yüksək)</td>
                        <td className="px-3 py-3 text-slate-300">{item.sources.map((value) => sourceLabel[value] ?? value).join(", ")}</td>
                        <td className="px-3 py-3 text-slate-300">{item.eventTypes.map((value) => eventLabel[value] ?? value).join(", ")}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-400">{formatDate(item.latestAt)}</td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            className="whitespace-nowrap font-medium text-emerald-300 hover:underline"
                            onClick={() => {
                              setSearch(item.sourceIp);
                              setSubmittedSearch(item.sourceIp);
                              setSource("");
                              setSeverity("");
                              setEventType("");
                              setAction("");
                              setPage(1);
                              document.getElementById("live-events")?.scrollIntoView({ behavior: "smooth" });
                            }}
                          >
                            Qeydləri araşdır
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[11px] leading-4 text-slate-500">
              Səbəb: eyni IP üzrə iki və ya daha çox saxlanmış hadisə. Zaman aralığı: {formatDate(data.summary.windowStart)} – {formatDate(data.summary.windowEnd)}. Nəticə üçün istifadə olunan qeyd sayı və mənbələr yuxarıda göstərilir.
            </p>
          </section>

          <section id="waf" aria-labelledby="waf-title" className="mt-8 grid gap-3 scroll-mt-6 lg:grid-cols-[1fr_2fr]">
            <div className={panelClass}>
              <h2 id="waf-title" className="flex items-center gap-2 font-semibold text-white"><ShieldAlert size={17} className="text-amber-300" aria-hidden="true" /> WAF / ModSecurity</h2>
              <p className="mt-2 text-sm text-slate-300">
                Bazada saxlanmış Apache/ModSecurity hadisələri: <strong className="text-white">{data.integrations.apache.eventsInWindow}</strong> · {timeWindowLabels[data.summary.window].toLowerCase()}
              </p>
              <Freshness source={data.integrations.apache} now={asOf} configuration={data.integrations.apache.receiverConfigured ? "configured" : "unconfigured"} />
              <p className="mt-3 text-xs text-slate-400">
                {data.integrations.apache.receiverConfigured
                  ? "Server tərəfində imzalı qəbul üçün secret konfiqurasiya edilib; bu, agentin qoşulduğunu təsdiqləmir."
                  : "İmzalı Apache qəbul secret-i konfiqurasiya edilməyib."}
              </p>
            </div>
            <div className={panelClass}>
              <h3 className="text-sm font-semibold text-white">Saxlanılan WAF təfərrüatı</h3>
              {data.integrations.apache.eventsInWindow === 0 ? (
                <p className="mt-3 text-sm text-slate-400">Seçilmiş müddətdə Apache/ModSecurity qeydi yoxdur.</p>
              ) : (
                <>
                  <p className="mt-3 text-sm text-slate-300">Qayda ID-si saxlanıbsa hadisələrdə göstərilir. Məsələn, OWASP CRS ID-si yalnız real saxlanmış qeyddən görünür.</p>
                  <p className="mt-2 text-xs text-slate-400">Hadisə mesajı və ModSecurity xam audit bölmələri mövcud sxemdə saxlanmır; bu panel onları göstərə bilməz.</p>
                  <a href="#live-events" className="mt-3 inline-block text-sm font-medium text-emerald-300 underline">Apache qeydlərinə bax</a>
                </>
              )}
            </div>
          </section>

          <section id="application" aria-labelledby="application-title" className="mt-8 grid gap-3 scroll-mt-6 lg:grid-cols-2">
            <div className={panelClass}>
              <h2 id="application-title" className="flex items-center gap-2 font-semibold text-white"><Activity size={17} className="text-sky-300" aria-hidden="true" /> Tətbiq və API təhlükəsizliyi</h2>
              <p className="mt-2 text-sm text-slate-300">
                Kodda hadisə istehsalçısı mövcud olan növlər:
              </p>
              <ul className="mt-3 space-y-2">
                {data.coverage.applicationInstrumentedEventTypes.map((item) => (
                  <li key={item} className="flex items-center justify-between gap-3 rounded-lg bg-slate-950/60 px-3 py-2 text-xs">
                    <span className="text-slate-200">{eventLabel[item] ?? item}</span>
                    <span className="font-mono text-slate-400">{data.coverage.applicationEventCounts.find((entry) => entry.eventType === item)?.count ?? "Bu müddətdə qeyd yoxdur"}</span>
                  </li>
                ))}
              </ul>
              <Freshness source={data.integrations.application} now={asOf} configuration="configured" />
            </div>
            <div className={panelClass}>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><CircleHelp size={16} className="text-amber-200" aria-hidden="true" /> İstehsalçısı qoşulmamış növlər</h3>
              <ul className="mt-3 space-y-2">
                {data.coverage.applicationNotInstrumentedEventTypes.map((item) => (
                  <li key={item} className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-slate-700 px-3 py-2 text-xs">
                    <span className="text-slate-300">{eventLabel[item] ?? item}</span>
                    <span className="text-amber-200">Tətbiqdə istehsalçı yoxdur</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-5 text-slate-400">Hadisə növünün sxemdə qəbul edilməsi həmin növ üçün tətbiq daxilində aşkarlama və ya toplama işlədiyini göstərmir. Xarici imzalı qəbul yolu ayrıca mövcuddur, lakin mənbə əlaqəsi yalnız məlumat bazasında saxlanmış qeydlərlə görünür.</p>
            </div>
          </section>

          <section id="sources" aria-labelledby="sources-title" className="mt-8 scroll-mt-6">
            <div className="mb-3">
              <h2 id="sources-title" className="text-lg font-semibold text-white">Mənbələr və sağlamlıq</h2>
              <p className="mt-1 text-xs text-slate-400">Sazlama, saxlanmış hadisə və aktiv əlaqə ayrı anlayışlardır. Bu mənbələrdə ayrıca nəbz siqnalı yoxdur.</p>
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <article className={panelClass}>
                <h3 className="flex items-center gap-2 font-semibold text-white"><Server size={17} className="text-sky-300" aria-hidden="true" /> BAGATI tətbiqi</h3>
                <p className="mt-2 text-xs leading-5 text-slate-400">Yalnız uğursuz girişlər və limit səbəbi ilə rədd edilmiş giriş cəhdləri üçün istehsalçı mövcuddur.</p>
                <Freshness source={data.integrations.application} now={asOf} configuration="configured" />
              </article>
              <article className={panelClass}>
                <h3 className="flex items-center gap-2 font-semibold text-white"><Wifi size={17} className="text-orange-200" aria-hidden="true" /> Apache / ModSecurity</h3>
                <p className="mt-2 text-xs leading-5 text-slate-400">Qəbul sirri yalnız server sazlamasını göstərir; Ubuntu agentinin işlədiyini və ya logun ötürüldüyünü təsdiqləmir.</p>
                <Freshness source={data.integrations.apache} now={asOf} configuration={data.integrations.apache.receiverConfigured ? "configured" : "unconfigured"} />
                <p className="mt-2 text-xs text-slate-400">{data.integrations.apache.receiverConfigured ? "Qəbul sirri: sazlanıb" : "Qəbul sirri: sazlanmayıb"}</p>
              </article>
              <article className={panelClass}>
                <h3 className="flex items-center gap-2 font-semibold text-white"><WifiOff size={17} className="text-slate-300" aria-hidden="true" /> Cloudflare</h3>
                <p className="mt-2 text-xs leading-5 text-slate-400">Cloudflare təhlükəsizlik hadisələri API-si üçün birbaşa inteqrasiya qurulmayıb. Tunnel istifadəsi bu paneldə telemetriyanın toplandığını göstərmir.</p>
                <Freshness source={data.integrations.cloudflare} now={asOf} configuration={data.integrations.cloudflare.relaySecretConfigured ? "configured" : "not-implemented"} />
                <p className="mt-2 text-xs text-slate-400">
                  İmzalı ötürücü sirri: {data.integrations.cloudflare.relaySecretConfigured ? "sazlanıb (mənbə əlaqəsini sübut etmir)" : "sazlanmayıb"}.
                </p>
              </article>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-100"><Database size={16} aria-hidden="true" /> Təhlükəsizlik anbarı</p>
                <p className="mt-1 text-xs text-emerald-200">Oxu sorğusu uğurla tamamlandı · {formatDate(data.services.checkedAt)}</p>
                <p className="mt-1 text-xs text-slate-500">Bu yalnız hazırkı sorğunun nəticəsidir; uptime və ya davamlı əlçatanlıq ölçüsü deyil.</p>
              </div>
              <div className="rounded-xl border border-rose-900/60 bg-rose-950/20 p-4">
                <p className="flex items-center gap-2 text-sm font-medium text-rose-100"><LockKeyhole size={16} aria-hidden="true" /> IP nəzarəti</p>
                <p className="mt-1 text-xs text-rose-200">Bloklama adapteri tətbiq edilməyib; trafik bloklanmır.</p>
              </div>
            </div>
          </section>

          <section id="ip-management" aria-labelledby="ip-management-title" className={`${panelClass} mt-8 scroll-mt-6`}>
            <h2 id="ip-management-title" className="flex items-center gap-2 text-sm font-semibold text-white"><LockKeyhole size={16} className="text-rose-200" aria-hidden="true" /> IP idarəetməsi</h2>
            <p className="mt-2 text-sm text-rose-100">Hazır deyil — firewall və ya Cloudflare inteqrasiyası tələb olunur.</p>
            <p className="mt-2 text-xs leading-5 text-slate-400">Bu interfeys IP bloklamır. Təsdiq, təhlükəsiz siyahı, müddət və administrator auditi real idarəetmə adapteri və sınaqdan keçmiş siyasət olmadan aktiv edilmir.</p>
          </section>

          <section id="investigation" aria-labelledby="investigation-title" className="mt-8 scroll-mt-6">
            <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 sm:p-5">
              <h2 id="investigation-title" className="flex items-center gap-2 font-semibold text-white"><Search size={17} className="text-emerald-300" aria-hidden="true" /> Audit və araşdırma</h2>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">
                Hadisələri yuxarıdakı axtarış və süzgəclərlə daraldın. Təfərrüatlarda saxlanmış mənbə, başvermə və qəbul vaxtı, IP (mövcud olduqda), sorğu parametrləri çıxarılmış yol, hadisə növü, risk, nəticə və qayda identifikatoru göstərilir. Mənbə hadisə identifikatoru saxlanarkən SHA-256 ilə heşlənir.
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                Mövcud verilənlər bazası sxemində ModSecurity mesajı, xam sorğu, cookie, avtorizasiya məlumatı və əlavə metaverilən saxlanmır; araşdırma paneli bunları uydurmur və göstərmir.
              </p>
            </div>
          </section>
          </div>

          <aside className="space-y-4 2xl:sticky 2xl:top-5 2xl:self-start">
            <section id="incidents" aria-labelledby="priority-title" className={`${panelClass} scroll-mt-6`}>
              <div className="flex items-center justify-between gap-2">
                <h2 id="priority-title" className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Siren size={16} className="text-rose-300" aria-hidden="true" /> Kritik və yüksək risk
                </h2>
                <span className="rounded-full border border-rose-900 px-2 py-0.5 text-[10px] text-rose-200">{data.priorityEvents.length}</span>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-slate-500">
                Seçilmiş müddətdə məlumat bazasında saxlanmış kritik/yüksək qeydlərdir; insident təsnifatı və ya hücum təsdiqi deyil.
              </p>
              {data.priorityEvents.length === 0 ? (
                <p className="mt-4 rounded-lg border border-dashed border-slate-700 p-3 text-xs text-slate-400">Bu müddətdə kritik və ya yüksək riskli hadisə qeydə alınmayıb.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {data.priorityEvents.map((item) => (
                    <li key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                      <button type="button" onClick={() => setSelectedEvent(item)} className="block w-full text-left">
                        <span className="flex items-start justify-between gap-2">
                          <span className="text-xs font-medium text-slate-100">{eventLabel[item.eventType] ?? item.eventType}</span>
                          <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] ${severityStyle[item.severity] ?? severityStyle.HIGH}`}>
                            {severityLabel[item.severity] ?? item.severity}
                          </span>
                        </span>
                        <span className="mt-2 block text-[10px] text-slate-400">{sourceLabel[item.source] ?? item.source}</span>
                        <span className="mt-1 block text-[10px] text-slate-500">Baş verib: {formatDate(item.occurredAt)}</span>
                        <span className="mt-1 block text-[10px] text-slate-500">Qəbul edilib: {formatDate(item.receivedAt)}</span>
                        {item.sourceIp && <span className="mt-2 block font-mono text-[10px] text-slate-300">{item.sourceIp}</span>}
                        {item.ruleId && <span className="mt-1 block font-mono text-[10px] text-slate-400">Qayda: {item.ruleId}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={panelClass}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Activity size={16} className="text-amber-200" aria-hidden="true" /> Təkrarlanan IP-lər</h2>
              {data.repeatedIps.length === 0 ? (
                <p className="mt-3 text-xs leading-5 text-slate-400">Qiymətləndirmə üçün məlumat kifayət deyil.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {data.repeatedIps.slice(0, 4).map((item) => (
                    <li key={item.sourceIp} className="flex items-center justify-between gap-3 border-b border-slate-800 pb-2">
                      <span className="min-w-0 truncate font-mono text-[11px] text-slate-300">{item.sourceIp}</span>
                      <span className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-[10px] tabular-nums text-slate-200">{item.count} qeyd</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[10px] leading-4 text-slate-500">Yalnız müşahidə edilmiş təkrar qeydlər; ünvanın sahibinə dair nəticə deyil.</p>
            </section>

            <section className={panelClass}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><LockKeyhole size={16} className="text-rose-200" aria-hidden="true" /> IP idarəetməsi</h2>
              <p className="mt-3 rounded-lg border border-amber-900/70 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100">
                Hazır deyil — real firewall və ya Cloudflare qayda inteqrasiyası tələb olunur.
              </p>
              <a href="#ip-management" className="mt-3 inline-block text-xs font-medium text-emerald-300 underline">Ətraflı məhdudiyyətlər</a>
            </section>

            <section className={panelClass}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><Wifi size={16} className="text-emerald-200" aria-hidden="true" /> Mənbə vəziyyəti</h2>
              <ul className="mt-3 space-y-3 text-xs">
                <li className="flex items-start justify-between gap-2"><span className="text-slate-300">Tətbiq</span><span className="text-right text-slate-400">{data.integrations.application.eventsLast15Minutes > 0 ? "Son məlumat yeni" : "Son 15 dəqiqədə qeyd yoxdur"}</span></li>
                <li className="flex items-start justify-between gap-2"><span className="text-slate-300">Apache</span><span className="text-right text-slate-400">{!data.integrations.apache.receiverConfigured ? "Qoşulmayıb" : data.integrations.apache.lastReceivedAt ? ageLabel(data.integrations.apache.lastReceivedAt, asOf) : "Hadisə qeydə alınmayıb"}</span></li>
                <li className="flex items-start justify-between gap-2"><span className="text-slate-300">Cloudflare</span><span className="text-right text-amber-200">Birbaşa izləmə qurulmayıb</span></li>
              </ul>
              <p className="mt-3 text-[10px] leading-4 text-slate-500">Son qəbul olunma nəbz siqnalı deyil və fasiləsiz əlaqəni təsdiqləmir.</p>
            </section>
          </aside>
        </div>
      )}
        </div>
      </div>

      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedEvent(null);
        }}>
          <aside
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-detail-title"
            className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-700 bg-[#0b1723] p-5 shadow-2xl sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-emerald-300">Saxlanmış hadisə təfərrüatı</p>
                <h2 id="event-detail-title" className="mt-2 text-xl font-semibold text-white">{eventLabel[selectedEvent.eventType] ?? selectedEvent.eventType}</h2>
              </div>
              <button type="button" aria-label="Təfərrüat panelini bağla" onClick={() => setSelectedEvent(null)} className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800"><X size={18} /></button>
            </div>
            <dl className="mt-6 divide-y divide-slate-800">
              {[
                ["Vaxt", formatDate(selectedEvent.occurredAt)],
                ["Sistemə qəbul vaxtı", formatDate(selectedEvent.receivedAt)],
                ["Mənbə", sourceLabel[selectedEvent.source] ?? selectedEvent.source],
                ["Mənbə IP-si", selectedEvent.sourceIp ?? "Təqdim edilməyib"],
                ["Sorğu yolu", selectedEvent.path ?? "Saxlanmayıb"],
                ["Ciddilik", severityLabel[selectedEvent.severity] ?? selectedEvent.severity],
                ["Əməliyyat", actionLabel[selectedEvent.action] ?? selectedEvent.action],
                ["Qayda ID-si", selectedEvent.ruleId ?? "Saxlanmayıb"],
                ["Mənbə hadisə ID-sinin heşi", selectedEvent.sourceEventId],
                ["Daxili qeyd ID-si", selectedEvent.id],
              ].map(([label, value]) => (
                <div key={label} className="grid gap-1 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="break-all font-mono text-xs text-slate-200">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs leading-5 text-slate-400">
              {selectedEvent.action === "BLOCKED"
                ? "Bloklanıb qeydi hadisənin nəticəsidir; bu, davamlı IP blok qaydasının mövcud olduğunu bildirmir."
                : "Bu qeyd təkbaşına hadisənin hücum olduğunu və ya trafikə blok tətbiq edildiyini təsdiqləmir."}
            </p>
            {selectedEvent.source === "APACHE_MODSECURITY" && (
              <p className="mt-3 text-xs leading-5 text-slate-400">ModSecurity mesajı cari məlumat bazası sxemində saxlanmadığı üçün göstərilmir.</p>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
