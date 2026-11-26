"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/admin-ui/page-header";
import { buttonClass } from "@/components/admin-ui/styles";
import type { SystemStatusData as CachedCardData } from "@/lib/admin-system-status-cards";
import type { ClientIpDiagnostics } from "@/lib/client-ip-diagnostics";
import { evaluateSpoofTest, SPOOF_TEST_HEADERS, SPOOF_TEST_TEXTS, spoofTestDisplay, type SpoofTestOutcome } from "@/lib/admin-ip-spoof-test";

/** Cached cards plus the request-specific client IP card. */
type SystemStatusData = CachedCardData & { "client-ip": ClientIpDiagnostics };
type CardName = keyof SystemStatusData;
type CardState = { status: "loading" | "ready" | "unavailable"; data?: SystemStatusData[CardName]; generatedAt?: string };

const card = "rounded-card border border-line bg-white p-5";
const BAKU = "Asia/Baku";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("az-AZ", { timeZone: BAKU, dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}
function formatDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} san`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} dəq`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} saat ${minutes % 60} dəq`;
  return `${Math.floor(hours / 24)} gün`;
}
function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
const yesNo = (value: boolean) => value ? "Bəli" : "Xeyr";

const emailStatus: Record<string, string> = { PENDING: "Növbədə", PROCESSING: "Göndərilir", SENT: "Göndərilib", FAILED: "Uğursuz" };
const importStatus: Record<string, string> = {
  UPLOADING: "Yüklənir", QUEUED: "Növbədə", PROCESSING: "İşlənir", PAUSED: "Dayandırılıb", COMPLETED: "Tamamlanıb",
  COMPLETED_WITH_ERRORS: "Xətalarla tamamlanıb", FAILED: "Uğursuz", CANCELLED: "Ləğv edilib",
};
const storageLabel: Record<string, string> = { local: "Lokal disk", s3: "S3 obyekt yaddaşı", unconfigured: "Konfiqurasiya edilməyib" };
const workerLabel: Record<string, string> = {
  alive: "İşləyir",
  stale: "Worker işləmir və ya vəziyyəti məlum deyil (son siqnal köhnədir)",
  stopped: "Worker dayandırılıb",
  unknown: "Worker işləmir və ya vəziyyəti məlum deyil",
};

function Row({ label, children, tone }: { label: string; children: ReactNode; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-green-800" : tone === "warn" ? "text-amber-800" : tone === "bad" ? "text-red-700" : "text-fg";
  return <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-2.5 text-sm last:border-0">
    <dt className="text-fg-secondary">{label}</dt>
    <dd className={`min-w-0 break-words text-right font-medium ${color}`}>{children}</dd>
  </div>;
}

function CountGrid({ counts, labels }: { counts: Record<string, number>; labels: Record<string, string> }) {
  const keys = Object.keys(labels);
  return <div className="mt-3 grid grid-cols-2 gap-2">{keys.map((key) => <div key={key} className="rounded-control bg-surface-page px-3 py-2.5">
    <p className="text-xs text-fg-secondary">{labels[key]}</p>
    <p className="mt-1 text-xl font-semibold text-fg">{counts[key] ?? 0}</p>
  </div>)}</div>;
}

function Warning({ children }: { children: ReactNode }) {
  return <p role="status" className="mt-3 rounded-control border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{children}</p>;
}

function DatabaseBody({ data }: { data: SystemStatusData["database"] }) {
  return <>
    <dl>
      <Row label="Əlaqə" tone="good">Var</Row>
      <Row label="Gecikmə" tone={data.latencyMs > 250 ? "warn" : undefined}>{data.latencyMs} ms</Row>
      <Row label="Server saat qurşağı">{data.timezone ?? "—"}</Row>
      <Row label="PostgreSQL versiyası">{data.postgresMajor ?? "—"}</Row>
      <Row label="Tətbiq olunmuş miqrasiyalar">{data.appliedMigrations}</Row>
      <Row label="Son miqrasiya">{data.latestMigration ? <><span className="block font-mono text-xs">{data.latestMigration.name}</span><span className="text-xs text-fg-secondary">{formatDateTime(data.latestMigration.finishedAt)}</span></> : "—"}</Row>
    </dl>
    {!data.repoMigrationsReadable && <Warning>Repozitoriyadakı miqrasiya qovluğu oxunmadı, müqayisə aparılmadı.</Warning>}
    {data.missingMigrations?.length > 0 && <Warning>Repozitoriyada olan, lakin bazada tətbiq olunmamış miqrasiyalar ({data.missingMigrations.length}):<span className="mt-1 block break-all font-mono text-xs">{data.missingMigrations.join(", ")}</span></Warning>}
  </>;
}

function ReadinessBody({ data }: { data: SystemStatusData["readiness"] }) {
  return <dl>
    <Row label="Fayl yaddaşı" tone={data.storage === "unconfigured" ? "bad" : "good"}>{storageLabel[data.storage] ?? data.storage}</Row>
    <Row label="Google ilə giriş" tone={data.googleSignIn === "configured" ? "good" : "warn"}>{data.googleSignIn === "configured" ? "Konfiqurasiya edilib" : "Konfiqurasiya edilməyib"}</Row>
    <Row label="İstinad məlumatları (şəhər, kateqoriya)" tone={data.referenceData === "present" ? "good" : "bad"}>{data.referenceData === "present" ? "Mövcuddur" : "Çatışmır"}</Row>
  </dl>;
}

function EmailBody({ data }: { data: SystemStatusData["email"] }) {
  return <>
    <CountGrid counts={data.byStatus} labels={emailStatus} />
    <dl className="mt-3">
      <Row label="Ən köhnə gözləyən məktubun yaşı" tone={(data.oldestPendingAgeMs ?? 0) > 5 * 60_000 ? "warn" : undefined}>{formatDuration(data.oldestPendingAgeMs)}</Row>
      <Row label="Son 24 saatda uğursuzluqlar" tone={data.failedLast24h ? "bad" : undefined}>{data.failedLast24h}</Row>
      <Row label="SMTP konfiqurasiyası" tone={data.smtpConfigured ? "good" : "bad"}>{yesNo(data.smtpConfigured)}</Row>
      <Row label="EMAIL_ENCRYPTION_KEY" tone={data.encryptionKeyConfigured ? "good" : "warn"}>{yesNo(data.encryptionKeyConfigured)}</Row>
      <Row label="Daxili göndərici (EMAIL_WORKER_ENABLED)" tone={data.inProcessWorkerEnabled ? "good" : "warn"}>{data.inProcessWorkerEnabled ? "Aktivdir" : "Söndürülüb"}</Row>
      <Row label="İşçi proses" tone={data.workerState === "alive" && !data.workerLastPollErrorCode ? "good" : "warn"}>{workerLabel[data.workerState] ?? workerLabel.unknown}{data.workerHeartbeatAt && <span className="block text-xs text-fg-secondary">Son siqnal: {formatDateTime(data.workerHeartbeatAt)}{data.workerHeartbeatSource === "file" ? " (CLI worker)" : ""}</span>}{data.workerLastPollErrorCode && <span className="block text-xs text-amber-800">Son xəta kodu: {data.workerLastPollErrorCode}</span>}</Row>
    </dl>
    {!data.encryptionKeyConfigured && data.encryptionUsable && <p className="mt-2 text-xs text-fg-secondary">Ayrıca açar yoxdur; şifrələmə ehtiyat açarla işləyir.</p>}
  </>;
}

function ImportsBody({ data }: { data: SystemStatusData["imports"] }) {
  return <>
    <CountGrid counts={data.byStatus} labels={importStatus} />
    <dl className="mt-3">
      <Row label={`İlişib qalan (${data.stuckThresholdMinutes} dəq-dən çox yenilənməyib)`} tone={data.stuck ? "warn" : undefined}>{data.stuck}</Row>
      <Row label="Son 24 saatda uğursuz" tone={data.failedLast24h ? "bad" : undefined}>{data.failedLast24h}</Row>
    </dl>
    <h3 className="mt-4 text-sm font-semibold">Son 10 iş</h3>
    {data.recent.length ? <ul className="mt-2 divide-y divide-line text-sm">{data.recent.map((job) => <li key={job.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
      <span className="min-w-0 break-words font-medium">{job.storeName}</span>
      <span className="text-xs text-fg-secondary">{importStatus[job.status] ?? job.status} · {job.processedRows}/{job.totalRows} sətir{job.failedRows ? ` · ${job.failedRows} xəta` : ""} · {formatDateTime(job.createdAt)}</span>
    </li>)}</ul> : <p className="mt-2 rounded-control bg-surface-page p-3 text-sm text-fg-secondary">İdxal işi yoxdur.</p>}
  </>;
}

function SecurityBody({ data }: { data: SystemStatusData["security"] }) {
  return <>
    {data.byType.length ? <div className="mt-1 overflow-x-auto"><table className="w-full text-left text-sm">
      <thead className="text-xs text-fg-secondary"><tr><th className="py-2 font-medium">Hadisə növü</th><th className="py-2 text-right font-medium">24 saat</th><th className="py-2 text-right font-medium">7 gün</th></tr></thead>
      <tbody className="divide-y divide-line">{data.byType.map((row) => <tr key={row.eventType}><td className="break-all py-2 font-mono text-xs">{row.eventType}</td><td className="py-2 text-right">{row.last24h}</td><td className="py-2 text-right">{row.last7d}</td></tr>)}</tbody>
    </table></div> : <p className="rounded-control bg-surface-page p-3 text-sm text-fg-secondary">Son 7 gündə təhlükəsizlik hadisəsi yoxdur.</p>}
  </>;
}

function BusinessBody({ data }: { data: SystemStatusData["business"] }) {
  return <dl>
    <Row label="Bu gün sifarişlər (Bakı vaxtı)">{data.ordersToday}</Row>
    <Row label="Bu gün uğursuz ödənişlər" tone={data.failedPaymentsToday ? "bad" : undefined}>{data.failedPaymentsToday}</Row>
    <Row label="Son 7 gündə yeni satıcılar">{data.newSellers7d}</Row>
    <Row label="Yoxlama gözləyən satıcı müraciətləri" tone={data.pendingSellerApplications ? "warn" : undefined}>{data.pendingSellerApplications}</Row>
    <Row label="Yoxlama gözləyən mağazalar" tone={data.pendingStoreReviews ? "warn" : undefined}>{data.pendingStoreReviews}</Row>
    <Row label="Oxunmamış alıcı mesajları" tone={data.unreadInquiries ? "warn" : undefined}>{data.unreadInquiries}</Row>
  </dl>;
}

function ApplicationBody({ data }: { data: SystemStatusData["application"] }) {
  return <dl>
    <Row label="Tətbiq versiyası">{data.version ?? "—"}</Row>
    {data.buildId && <Row label="Versiya nömrəsi"><span className="font-mono text-xs">{data.buildId}</span></Row>}
    <Row label="Mühit">{data.environment}</Row>
    <Row label="Node.js">{data.nodeVersion}</Row>
    <Row label="Prosesin iş vaxtı">{formatDuration(data.uptimeSeconds * 1000)}</Row>
    <Row label="Yaddaş (RSS)">{formatBytes(data.memory.rssBytes)}</Row>
    <Row label="Heap istifadəsi">{formatBytes(data.memory.heapUsedBytes)} / {formatBytes(data.memory.heapTotalBytes)}</Row>
  </dl>;
}

function ClientIpBody({ data }: { data: SystemStatusData["client-ip"] }) {
  return <>
    <p className="text-xs text-fg-secondary">Yalnız sizin bu sorğunuz. Dəyərlər maskalanıb; tam IP göstərilmir.</p>
    <dl className="mt-2">
      {data.headers.map((header) => <Row key={header.name} label={header.name} tone={header.present ? undefined : "warn"}>
        {header.present ? <span className="font-mono text-xs">{header.values.join(", ") || "boş"}</span> : "yoxdur"}
      </Row>)}
      <Row label="Socket ünvanı">{data.socketAddressAvailable ? "əlçatandır" : "birbaşa əlçatan deyil"}</Row>
    </dl>
    {data.forwardedChain.length > 0 && <>
      <h3 className="mt-4 text-sm font-semibold">X-Forwarded-For zənciri (soldan sağa)</h3>
      <ol className="mt-2 space-y-1 text-xs">{data.forwardedChain.map((hop, index) => <li key={index} className="flex justify-between gap-3 rounded-lg bg-surface-page px-3 py-1.5">
        <span className="font-mono">{hop.masked}</span><span className={hop.cloudflare ? "font-semibold text-green-800" : "text-fg-secondary"}>{hop.cloudflare ? "Cloudflare diapazonu" : "Cloudflare deyil"}</span>
      </li>)}</ol>
    </>}
    <dl className="mt-3">
      <Row label="BAGATI_TRUST_CLOUDFLARE_IP" tone={data.flagEnabled ? "good" : "warn"}>{data.flagEnabled ? "true" : "false / təyin edilməyib"}</Row>
      <Row label="İstifadə olunan IP (bayraq söndürülü)">{data.ipWithFlagOff ?? "yoxdur"}</Row>
      <Row label="İstifadə olunan IP (bayraq aktiv)" tone={data.ipWithFlagOn ? "good" : "bad"}><span className="font-mono text-xs">{data.ipWithFlagOn ?? "yoxdur"}</span></Row>
      <Row label="Son hop Cloudflare-dir">{data.rightmostHopCloudflare === null ? "—" : yesNo(data.rightmostHopCloudflare)}</Row>
      <Row label="CF-Connecting-IP = XFF ilk dəyəri">{data.cfConnectingIpMatchesLeftmostXff === null ? "—" : yesNo(data.cfConnectingIpMatchesLeftmostXff)}</Row>
      <Row label="CF-Connecting-IP ≠ X-Real-IP (IP etibarsız)" tone={data.cfRealIpMismatch ? "bad" : undefined}>{yesNo(data.cfRealIpMismatch)}</Row>
    </dl>
    <SpoofTest baselineIp={data.ipWithFlagOn} />
  </>;
}

/**
 * ADMIN-IP-TEST-1: repeats this card's request with forged CF-Connecting-IP / X-Real-IP (198.51.100.23, a documentation
 * address) and shows whether the app would trust them (lib/admin-ip-spoof-test.ts). Same admin-only GET endpoint.
 */
function SpoofTest({ baselineIp }: { baselineIp: string | null }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SpoofTestOutcome | null>(null);
  async function run() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/system?card=client-ip", { cache: "no-store", headers: SPOOF_TEST_HEADERS });
      const body = await response.json().catch(() => null);
      setOutcome(evaluateSpoofTest({ ok: response.ok && body?.ok === true, httpStatus: response.status, ipWithFlagOn: body?.data?.ipWithFlagOn, baselineIp }));
    } catch {
      setOutcome(evaluateSpoofTest({ ok: false, httpStatus: null, ipWithFlagOn: null, baselineIp }));
    } finally { setBusy(false); }
  }
  const display = outcome ? spoofTestDisplay(outcome) : null;
  const box = display?.tone === "bad" ? "border-red-200 bg-red-50 text-red-800" : display?.tone === "good" ? "border-green-200 bg-green-50 text-green-900" : "border-line bg-surface-page text-fg-body";
  return <div className="mt-4 border-t border-line pt-4">
    <p className="text-xs text-fg-secondary">{SPOOF_TEST_TEXTS.intro}</p>
    <button type="button" onClick={() => void run()} disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-control border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-gold-700 disabled:opacity-60">
      {busy ? SPOOF_TEST_TEXTS.busy : SPOOF_TEST_TEXTS.button}
    </button>
    {outcome && display && <div role="status" className={`mt-3 rounded-control border p-3 text-sm ${box}`}>
      {display.message && <p className="font-semibold">{display.message}</p>}
      {display.note && <p className={display.message ? "mt-1 text-fg-body" : undefined}>{display.note}</p>}
      <p className="mt-2 text-xs">{SPOOF_TEST_TEXTS.returnedIp}: <span className="font-mono">{outcome.returnedIp ?? SPOOF_TEST_TEXTS.none}</span>{outcome.reason === "refused" && <> · {SPOOF_TEST_TEXTS.requestFailed}{outcome.httpStatus ? ` (HTTP ${outcome.httpStatus})` : ""}</>}</p>
    </div>}
  </div>;
}

function spec<K extends CardName>(name: K, title: string, Body: (props: { data: SystemStatusData[K] }) => ReactNode) {
  // The API returns the shape for the card that was requested, so the narrowing cast is sound.
  return { name, title, render: (data: SystemStatusData[CardName]) => <Body data={data as SystemStatusData[K]} /> };
}

const cards = [
  spec("database", "Verilənlər bazası", DatabaseBody),
  spec("readiness", "Hazırlıq yoxlaması", ReadinessBody),
  spec("email", "E-poçt növbəsi", EmailBody),
  spec("business", "Biznes göstəriciləri", BusinessBody),
  spec("imports", "Məhsul idxalı işləri", ImportsBody),
  spec("security", "Təhlükəsizlik hadisələri", SecurityBody),
  spec("application", "Tətbiq", ApplicationBody),
  spec("client-ip", "Müştəri IP başlıqları", ClientIpBody),
];

export default function AdminSystemStatus() {
  const [states, setStates] = useState<Record<CardName, CardState>>(() =>
    Object.fromEntries(cards.map((item) => [item.name, { status: "loading" }])) as Record<CardName, CardState>);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async (refresh: boolean) => {
    const current = ++generation.current;
    setRefreshing(true);
    setStates((previous) => Object.fromEntries(cards.map((item) => [item.name, { ...previous[item.name], status: "loading" }])) as Record<CardName, CardState>);
    await Promise.all(cards.map(async (item) => {
      let next: CardState = { status: "unavailable" };
      try {
        const response = await fetch(`/api/admin/system?card=${item.name}${refresh ? "&refresh=1" : ""}`, { cache: "no-store" });
        const body = await response.json();
        if (response.ok && body.ok) next = { status: "ready", data: body.data, generatedAt: body.generatedAt };
      } catch { /* Card shows "unavailable". */ }
      if (generation.current === current) setStates((previous) => ({ ...previous, [item.name]: next }));
    }));
    if (generation.current === current) setRefreshing(false);
  }, []);

  useEffect(() => { void load(false); }, [load]);

  return <>
    <PageHeader title="Sistem vəziyyəti" description="Yalnız oxuma. Hər kart ayrıca yüklənir və 15 saniyəyə qədər yaddaşdan göstərilə bilər. Avtomatik yenilənmə yoxdur." actions={<button type="button" onClick={() => void load(true)} disabled={refreshing} className={buttonClass("primary")}>
        <RefreshCw size={16} aria-hidden="true" className={refreshing ? "animate-spin" : undefined} />
        Yenilə
      </button>} />
    <div className="mt-1 grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
      {cards.map((item) => {
        const state = states[item.name];
        return <section key={item.name} aria-busy={state.status === "loading"} className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">{item.title}</h2>
            {state.generatedAt && <span className="text-xs text-fg-muted">{formatDateTime(state.generatedAt)}</span>}
          </div>
          <div className="mt-3">
            {state.status === "unavailable" ? <p className="rounded-control border border-red-200 bg-red-50 p-3 text-sm text-red-800">Məlumat əlçatan deyil.</p>
              : state.data ? <div className={state.status === "loading" ? "opacity-50" : undefined}>{item.render(state.data)}</div>
                : <p className="text-sm text-fg-secondary">Yüklənir…</p>}
          </div>
        </section>;
      })}
    </div>
  </>;
}
