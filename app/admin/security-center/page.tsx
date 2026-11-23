import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, KeyRound, Radar, ShieldAlert, ShieldCheck, ShieldOff, Users, XCircle } from "lucide-react";
import AdminShell from "@/components/admin-shell";
import { ColumnChart } from "@/components/vendor-analytics-charts";
import { StackedColumnChart } from "@/components/stacked-column-chart";
import { IncidentMessages, IncidentQuickActions, ScanBulkResolve } from "@/components/security-incident-actions";
import { allClear, Badge, card, date, FullIpNotice, FullIpToggle, Ip, linkClass, SecurityCenterHeader, SeverityBadge, StatusBadge, unavailable } from "@/components/security-center-ui";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import { requireRole } from "@/lib/auth";
import { requireSecurityPermission } from "@/lib/security-monitoring/permissions";
import { clientIpDiagnostics } from "@/lib/client-ip-diagnostics";
import { maskIpAddress } from "@/lib/admin-system-status";
import { ipCheckLight } from "@/lib/security-center-view";
import {
  loadActiveAdminSessionCount, loadAdminLogins, loadAdmins, loadFailedLoginTrend, loadFailedLogins, loadOpenIncidents, loadScanNoise, recordFullIpView,
} from "@/lib/security-center-data";
import {
  attentionIncidents, CENTER_TEXT, dailyFailedLogins, DASHBOARD_TEXT, deviceText, hourlyFailedLogins, INCIDENT_HELP, incidentTotals, lastBakuDays, ruleName,
  securityVerdict, STATUS_TEXT, type StatusLevel,
} from "@/lib/security-center-status";

export const dynamic = "force-dynamic";

function Stat({ title, value, hint, icon, tone }: { title: string; value: ReactNode; hint?: ReactNode; icon: ReactNode; tone?: "good" | "warn" | "bad" }) {
  const accent = tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-800" : "text-[#0d1b2a]";
  return <div className={`${card} min-w-0`}>
    <div className="flex items-center gap-2 text-sm text-slate-500"><span aria-hidden="true" className="text-[#85621d]">{icon}</span>{title}</div>
    <p className={`mt-2 break-words text-2xl font-semibold ${accent}`}>{value}</p>
    {hint && <div className="mt-1 break-words text-xs text-slate-500">{hint}</div>}
  </div>;
}

const BANNER: Record<StatusLevel, { title: string; style: string; Icon: typeof ShieldCheck }> = {
  ok: { title: STATUS_TEXT.ok, style: "border-green-200 bg-green-50 text-green-950", Icon: ShieldCheck },
  attention: { title: STATUS_TEXT.attention, style: "border-amber-200 bg-amber-50 text-amber-950", Icon: ShieldAlert },
  problem: { title: STATUS_TEXT.problem, style: "border-red-200 bg-red-50 text-red-900", Icon: ShieldOff },
};

/**
 * Security center overview (SECURITY-PAGE-1 → DESIGN-1 dashboard → DESIGN-2 short overview). It answers three
 * questions: is everything OK (verdict), what exactly needs me (reasons + the 5 most important open incidents), what do
 * I do (a link per reason, the incident actions right here). Long lists live in the other tabs. Real data only,
 * read-only queries; full IPs only with ?ip=full after the SECURITY_FULL_IP_VIEW audit row.
 */
export default async function AdminSecurityCenterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireRole("ADMIN");
  if (!admin || !requireSecurityPermission(admin, "security.view")) redirect("/admin/login");
  const params = await searchParams;
  const wantsFull = (Array.isArray(params.ip) ? params.ip[0] : params.ip) === "full";
  const full = wantsFull ? await recordFullIpView(admin.id, "summary") : false;
  const canRespond = requireSecurityPermission(admin, "security.respond");
  const now = new Date();
  const light = ipCheckLight(clientIpDiagnostics(new Headers(await headers()), process.env.BAGATI_TRUST_CLOUDFLARE_IP === "true"));
  // One block after another: each is its own bounded read-only query (lib/security-center-data.ts).
  const admins = await loadAdmins();
  const logins = await loadAdminLogins(now);
  const activeSessions = await loadActiveAdminSessionCount(now);
  const failed = await loadFailedLogins(now);
  const trend = await loadFailedLoginTrend(now);
  const incidents = await loadOpenIncidents();
  const scan = await loadScanNoise(now);

  const failed24h = failed ? failed.byPath.reduce((sum, row) => sum + row.last24h, 0) : null;
  const failedPrev24h = failed ? failed.byPath.reduce((sum, row) => sum + row.prev24h, 0) : null;
  const failed7d = failed ? failed.byPath.reduce((sum, row) => sum + row.last7d, 0) : null;
  const adminFailed24h = failed ? failed.adminTargeted.filter((row) => now.getTime() - row.createdAt.getTime() <= 24 * 60 * 60 * 1000).length : null;
  const verdict = securityVerdict({
    admins,
    failed: failed24h === null || failedPrev24h === null ? null : { last24h: failed24h, prev24h: failedPrev24h },
    adminFailed24h,
    ip: light,
    incidents: incidents ? incidents.counts : null,
  }, now);
  const banner = BANNER[verdict.level];
  const totals = incidents ? incidentTotals(incidents.counts) : null;
  const attention = incidents ? attentionIncidents(incidents.list) : [];
  const activeAdmins = admins ? admins.filter((row) => row.isActive) : [];
  const twoFactorOn = activeAdmins.filter((row) => row.twoFactorOn).length;
  const lastLogin = logins?.[0] ?? null;
  const daily = trend ? dailyFailedLogins(trend.daily, lastBakuDays(now, 7)) : null;
  const hourly = trend ? hourlyFailedLogins(trend.hourly, now) : null;
  const scanDays = scan ? lastBakuDays(now, 7).map((day) => ({ day, count: scan.daily.find((row) => row.day === day)?.count ?? 0 })) : null;
  const scan7d = scanDays ? scanDays.reduce((sum, row) => sum + row.count, 0) : 0;
  const loginIp = (row: { ipFull: string | null; ipMasked: string | null }) => full && row.ipFull ? row.ipFull : row.ipMasked ?? (row.ipFull ? maskIpAddress(row.ipFull) : null);
  const ipTone = light.tone;

  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}>
    <SecurityCenterHeader active="overview" renderedAt={now.toISOString()} fullIp={full} actions={<FullIpToggle action="/admin/security-center" full={full}/>}/>
    <FullIpNotice wanted={wantsFull} full={full}/>

    {/* 1. Overall verdict: every reason says what it is and links to where it is handled. */}
    <section aria-labelledby="security-verdict" data-security-verdict={verdict.level} className={`mb-5 rounded-2xl border p-5 ${banner.style}`}>
      <div className="flex items-start gap-3">
        <banner.Icon size={28} aria-hidden="true" className="mt-0.5 shrink-0"/>
        <div className="min-w-0 flex-1">
          <h2 id="security-verdict" className="text-xl font-semibold">{banner.title}</h2>
          {verdict.reasons.length
            ? <ul className="mt-2 space-y-1.5 text-sm" data-verdict-reasons="">{verdict.reasons.map((reason) => <li key={reason.code} data-reason={reason.code} className="flex flex-wrap items-start gap-x-2 gap-y-1">
                {reason.level === "problem" ? <XCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0"/> : <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0"/>}
                <span className="min-w-0 flex-1">{reason.text}</span>
                {reason.href && reason.action
                  ? <Link href={reason.href} prefetch={false} className="inline-flex items-center gap-0.5 whitespace-nowrap font-semibold underline">{reason.action}<ChevronRight size={14} aria-hidden="true"/></Link>
                  : <span className="text-xs">{CENTER_TEXT.retry}</span>}
              </li>)}</ul>
            : <p className="mt-1 text-sm">{STATUS_TEXT.checked}</p>}
        </div>
      </div>
    </section>

    {/* 2. Summary cards. */}
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-security-cards="">
      <Stat icon={<KeyRound size={16}/>} title={DASHBOARD_TEXT.twoFactorTitle} tone={admins && twoFactorOn < activeAdmins.length ? "warn" : undefined}
        value={admins ? `${twoFactorOn} / ${activeAdmins.length}` : "—"} hint={DASHBOARD_TEXT.twoFactorHint}/>
      <Stat icon={<ShieldAlert size={16}/>} title={DASHBOARD_TEXT.failed24hTitle} value={failed24h ?? "—"} hint={failedPrev24h === null ? undefined : DASHBOARD_TEXT.previous24h(failedPrev24h)}/>
      <Stat icon={<ShieldAlert size={16}/>} title={DASHBOARD_TEXT.failed7dTitle} value={failed7d ?? "—"} hint={DASHBOARD_TEXT.failed7dHint}/>
      <Stat icon={<Users size={16}/>} title={DASHBOARD_TEXT.sessionsTitle} value={activeSessions ?? "—"} hint={DASHBOARD_TEXT.sessionsHint}/>
      <Stat icon={<Clock size={16}/>} title={DASHBOARD_TEXT.lastLoginTitle} value={<span className="text-lg">{lastLogin ? date(lastLogin.createdAt) : "—"}</span>}
        hint={lastLogin ? <>{lastLogin.email} · {deviceText(lastLogin.device)} · <Ip value={loginIp(lastLogin)} /></> : logins ? "Admin girişi qeydə alınmayıb." : undefined}/>
      <Stat icon={<ShieldCheck size={16}/>} title="IP yoxlaması" tone={ipTone === "good" ? undefined : ipTone}
        value={<span className="inline-flex items-center gap-2 text-lg">{ipTone === "good" ? <CheckCircle2 size={20} aria-hidden="true" className="text-green-700"/> : ipTone === "warn" ? <AlertTriangle size={20} aria-hidden="true"/> : <XCircle size={20} aria-hidden="true"/>}{light.title}</span>}
        hint={<>{light.detail} <Link href="/admin/system" className="font-medium text-[#85621d] underline">Sistem vəziyyəti → Müştəri IP başlıqları və saxtalaşdırma testi</Link></>}/>
    </div>

    {/* 3. The one "needs attention" list: at most 5 open incidents (not scan noise), with the actions right here. */}
    <section id="needs-attention" aria-labelledby="needs-attention-title" className={`${card} mb-5 min-w-0 scroll-mt-4`} data-attention-list="">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="needs-attention-title" className="font-semibold text-[#0d1b2a]">{CENTER_TEXT.attentionTitle}</h2>
        {totals && totals.high + totals.other > 0 && <Link href="/admin/security-center/incidents" prefetch={false} className={linkClass}>{CENTER_TEXT.seeAll(totals.high + totals.other)}</Link>}
      </div>
      <p className="mt-1 text-xs text-slate-500">{CENTER_TEXT.attentionNote}</p>
      {/* The message holder wraps the whole state, so "Həll edildi" on the last incident still shows its result. */}
      <div className="mt-3"><IncidentMessages>
        {!incidents ? unavailable : !attention.length ? allClear("Açıq insident yoxdur.") :
          <ul className="space-y-2">{attention.map((row) => {
            const help = INCIDENT_HELP[row.ruleKey];
            return <li key={row.id} className="rounded-xl border border-[#eeeae2] p-3" data-attention-item={row.severity}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={row.severity}/><StatusBadge status={row.status}/><span className="text-xs text-slate-500">{date(row.createdAt)}</span></div>
                  <p className="mt-1.5 font-medium text-[#0d1b2a]">{ruleName(row.ruleKey)}</p>
                  <p className="text-xs text-slate-500">{CENTER_TEXT.observed(row.observedValue, row.threshold, row.windowMinutes)}</p>
                  {help && <p className="mt-1 text-sm text-slate-700">{help.text} <Link href={help.href} prefetch={false} className="whitespace-nowrap font-medium text-[#85621d] underline">{CENTER_TEXT.details}</Link></p>}
                </div>
                {canRespond && (row.status === "OPEN" || row.status === "ACKNOWLEDGED") && <IncidentQuickActions id={row.id} status={row.status}/>}
              </div>
            </li>;
          })}</ul>}
      </IncidentMessages></div>
    </section>

    {/* 4. Failed logins over time. */}
    <div className="mb-5 grid gap-5 xl:grid-cols-2">
      <section className={`${card} min-w-0`} aria-labelledby="failed-7d" data-failed-chart="7d">
        <h2 id="failed-7d" className="font-semibold text-[#0d1b2a]">{DASHBOARD_TEXT.failed7dTitle}</h2>
        <div className="mt-3">{!daily ? unavailable : daily.buckets.every((bucket) => bucket.total === 0) ? allClear("Son 7 gündə uğursuz giriş yoxdur.")
          : <StackedColumnChart title={DASHBOARD_TEXT.failed7dTitle} series={daily.types} totalLabel={(column) => DASHBOARD_TEXT.failedCount(column.segments.reduce((s, x) => s + x.value, 0))}
              columns={daily.buckets.map((bucket) => ({ key: bucket.day, label: bucket.day.slice(5), segments: daily.types.map((type) => ({ series: type, value: bucket.byType[type] ?? 0 })) }))}/>}</div>
      </section>
      <section className={`${card} min-w-0`} aria-labelledby="failed-24h" data-failed-chart="24h">
        <h2 id="failed-24h" className="font-semibold text-[#0d1b2a]">{DASHBOARD_TEXT.failed24hTitle}</h2>
        <div className="mt-3">{!hourly ? unavailable : hourly.every((hour) => hour.count === 0) ? allClear(DASHBOARD_TEXT.noFailed24h)
          : <ColumnChart title={DASHBOARD_TEXT.failed24hTitle} axisLabel={(value) => String(value)} data={hourly.map((hour) => ({ key: hour.label, value: hour.count, label: `${hour.label}: ${DASHBOARD_TEXT.failedCount(hour.count)}` }))}/>}</div>
      </section>
    </div>

    {/* 5. Background internet scanning: calm, never counted as a problem, no protection claims. */}
    <section aria-labelledby="scan-noise" className={`${card} min-w-0`} data-scan-card="">
      <div className="flex flex-wrap items-center gap-2">
        <Radar size={18} aria-hidden="true" className="text-[#85621d]"/>
        <h2 id="scan-noise" className="font-semibold text-[#0d1b2a]">{CENTER_TEXT.scanTitle}</h2>
        <Badge tone="neutral">{CENTER_TEXT.scanBadge}</Badge>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-slate-600">{CENTER_TEXT.scanText}</p>
      {!scan || !scanDays ? <div className="mt-3">{unavailable}</div> : <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div className="text-sm text-slate-700">
          <p className="text-2xl font-semibold text-[#0d1b2a]">{scan.last24h}</p>
          <p>{CENTER_TEXT.scan24h(scan.last24h)}</p>
          <p className="text-slate-500">{CENTER_TEXT.scan7d(scan7d)}</p>
          <Link href="/admin/security-center/events" prefetch={false} className={`mt-2 inline-block ${linkClass}`}>Şübhəli fəaliyyət →</Link>
        </div>
        <div className="min-w-0">{scan7d === 0 ? <p className="rounded-xl bg-[#f8f7f4] p-3 text-sm text-slate-500">{CENTER_TEXT.scanNone}</p>
          : <ColumnChart title={CENTER_TEXT.scanChart} axisLabel={(value) => String(value)} data={scanDays.map((row) => ({ key: row.day.slice(5), value: row.count, label: `${row.day.slice(5)}: ${row.count}` }))}/>}</div>
      </div>}
      {totals && totals.scan > 0 && <p className="mt-4 border-t border-[#eeeae2] pt-3 text-sm text-slate-600">{CENTER_TEXT.scanOpen(totals.scan)}</p>}
      {/* Always mounted (it renders nothing when idle), so its result stays visible after the refresh empties the list. */}
      {canRespond && incidents && <ScanBulkResolve incidents={incidents.scan}/>}
    </section>
  </AdminShell>;
}
