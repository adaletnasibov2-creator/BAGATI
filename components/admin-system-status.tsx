"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import type { SystemStatusData } from "@/lib/admin-system-status-cards";

type CardName = keyof SystemStatusData;
type CardState = { status: "loading" | "ready" | "unavailable"; data?: SystemStatusData[CardName]; generatedAt?: string };

const card = "rounded-2xl border border-[#e7e3d9] bg-white p-5";
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
  const color = tone === "good" ? "text-green-800" : tone === "warn" ? "text-amber-800" : tone === "bad" ? "text-red-700" : "text-[#0d1b2a]";
  return <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[#f0ece4] py-2.5 text-sm last:border-0">
    <dt className="text-slate-500">{label}</dt>
    <dd className={`min-w-0 break-words text-right font-medium ${color}`}>{children}</dd>
  </div>;
}

function CountGrid({ counts, labels }: { counts: Record<string, number>; labels: Record<string, string> }) {
  const keys = Object.keys(labels);
  return <div className="mt-3 grid grid-cols-2 gap-2">{keys.map((key) => <div key={key} className="rounded-xl bg-[#f8f7f4] px-3 py-2.5">
    <p className="text-xs text-slate-500">{labels[key]}</p>
    <p className="mt-1 text-xl font-semibold text-[#0d1b2a]">{counts[key] ?? 0}</p>
  </div>)}</div>;
}

function Warning({ children }: { children: ReactNode }) {
  return <p role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{children}</p>;
}

function DatabaseBody({ data }: { data: SystemStatusData["database"] }) {
  return <>
    <dl>
      <Row label="Əlaqə" tone="good">Var</Row>
      <Row label="Gecikmə" tone={data.latencyMs > 250 ? "warn" : undefined}>{data.latencyMs} ms</Row>
      <Row label="Server saat qurşağı">{data.timezone ?? "—"}</Row>
      <Row label="PostgreSQL versiyası">{data.postgresMajor ?? "—"}</Row>
      <Row label="Tətbiq olunmuş miqrasiyalar">{data.appliedMigrations}</Row>
      <Row label="Son miqrasiya">{data.latestMigration ? <><span className="block font-mono text-xs">{data.latestMigration.name}</span><span className="text-xs text-slate-500">{formatDateTime(data.latestMigration.finishedAt)}</span></> : "—"}</Row>
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
      <Row label="Worker" tone={data.workerState === "alive" ? "good" : "warn"}>{workerLabel[data.workerState] ?? workerLabel.unknown}{data.workerHeartbeatAt && <span className="block text-xs text-slate-500">Son siqnal: {formatDateTime(data.workerHeartbeatAt)}</span>}</Row>
    </dl>
    {!data.encryptionKeyConfigured && data.encryptionUsable && <p className="mt-2 text-xs text-slate-500">Ayrıca açar yoxdur; şifrələmə ehtiyat açarla işləyir.</p>}
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
    {data.recent.length ? <ul className="mt-2 divide-y divide-[#f0ece4] text-sm">{data.recent.map((job) => <li key={job.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
      <span className="min-w-0 break-words font-medium">{job.storeName}</span>
      <span className="text-xs text-slate-500">{importStatus[job.status] ?? job.status} · {job.processedRows}/{job.totalRows} sətir{job.failedRows ? ` · ${job.failedRows} xəta` : ""} · {formatDateTime(job.createdAt)}</span>
    </li>)}</ul> : <p className="mt-2 rounded-xl bg-[#f8f7f4] p-3 text-sm text-slate-500">İdxal işi yoxdur.</p>}
  </>;
}

function SecurityBody({ data }: { data: SystemStatusData["security"] }) {
  return <>
    {data.byType.length ? <div className="mt-1 overflow-x-auto"><table className="w-full text-left text-sm">
      <thead className="text-xs text-slate-500"><tr><th className="py-2 font-medium">Hadisə növü</th><th className="py-2 text-right font-medium">24 saat</th><th className="py-2 text-right font-medium">7 gün</th></tr></thead>
      <tbody className="divide-y divide-[#f0ece4]">{data.byType.map((row) => <tr key={row.eventType}><td className="break-all py-2 font-mono text-xs">{row.eventType}</td><td className="py-2 text-right">{row.last24h}</td><td className="py-2 text-right">{row.last7d}</td></tr>)}</tbody>
    </table></div> : <p className="rounded-xl bg-[#f8f7f4] p-3 text-sm text-slate-500">Son 7 gündə təhlükəsizlik hadisəsi yoxdur.</p>}
    <h3 className="mt-4 text-sm font-semibold">Təkrarlanan IP-lər (7 gün, maskalanıb)</h3>
    {data.repeatedIps.length ? <ul className="mt-2 divide-y divide-[#f0ece4] text-sm">{data.repeatedIps.map((row, index) => <li key={`${row.ip}-${index}`} className="flex justify-between py-2"><span className="font-mono text-xs">{row.ip}</span><b>{row.count}</b></li>)}</ul> : <p className="mt-2 text-sm text-slate-500">Təkrarlanan IP yoxdur.</p>}
  </>;
}

function BusinessBody({ data }: { data: SystemStatusData["business"] }) {
  return <dl>
    <Row label="Bu gün sifarişlər (Bakı vaxtı)">{data.ordersToday}</Row>
    <Row label="Bu gün uğursuz ödənişlər" tone={data.failedPaymentsToday ? "bad" : undefined}>{data.failedPaymentsToday}</Row>
    <Row label="Son 7 gündə yeni satıcılar">{data.newSellers7d}</Row>
    <Row label="Yoxlama gözləyən mağazalar" tone={data.pendingStoreReviews ? "warn" : undefined}>{data.pendingStoreReviews}</Row>
    <Row label="Oxunmamış alıcı mesajları" tone={data.unreadInquiries ? "warn" : undefined}>{data.unreadInquiries}</Row>
  </dl>;
}

function ApplicationBody({ data }: { data: SystemStatusData["application"] }) {
  return <dl>
    <Row label="Tətbiq versiyası">{data.version ?? "—"}</Row>
    {data.buildId && <Row label="Build ID"><span className="font-mono text-xs">{data.buildId}</span></Row>}
    <Row label="Mühit">{data.environment}</Row>
    <Row label="Node.js">{data.nodeVersion}</Row>
    <Row label="Prosesin iş vaxtı">{formatDuration(data.uptimeSeconds * 1000)}</Row>
    <Row label="Yaddaş (RSS)">{formatBytes(data.memory.rssBytes)}</Row>
    <Row label="Heap istifadəsi">{formatBytes(data.memory.heapUsedBytes)} / {formatBytes(data.memory.heapTotalBytes)}</Row>
  </dl>;
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
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">BAGATI · ADMIN</p>
        <h1 className="mt-2 text-3xl font-semibold text-[#0d1b2a]">Sistem vəziyyəti</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">Yalnız oxuma. Hər kart ayrıca yüklənir və 15 saniyəyə qədər yaddaşdan göstərilə bilər. Avtomatik yenilənmə yoxdur.</p>
      </div>
      <button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        <RefreshCw size={16} aria-hidden="true" className={refreshing ? "animate-spin" : undefined} />
        Yenilə
      </button>
    </div>
    <div className="mt-7 grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
      {cards.map((item) => {
        const state = states[item.name];
        return <section key={item.name} aria-busy={state.status === "loading"} className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">{item.title}</h2>
            {state.generatedAt && <span className="text-xs text-slate-400">{formatDateTime(state.generatedAt)}</span>}
          </div>
          <div className="mt-3">
            {state.status === "unavailable" ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Məlumat əlçatan deyil.</p>
              : state.data ? <div className={state.status === "loading" ? "opacity-50" : undefined}>{item.render(state.data)}</div>
                : <p className="text-sm text-slate-500">Yüklənir…</p>}
          </div>
        </section>;
      })}
    </div>
  </>;
}
