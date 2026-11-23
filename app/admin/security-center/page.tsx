import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Clock, KeyRound, ShieldAlert, ShieldCheck, ShieldOff, Users, XCircle } from "lucide-react";
import AdminShell from "@/components/admin-shell";
import { ColumnChart } from "@/components/vendor-analytics-charts";
import { StackedColumnChart } from "@/components/stacked-column-chart";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import { requireRole } from "@/lib/auth";
import { requireSecurityPermission } from "@/lib/security-monitoring/permissions";
import { clientIpDiagnostics } from "@/lib/client-ip-diagnostics";
import { formatBakuDateTime } from "@/lib/admin-audit-log";
import { maskIpAddress } from "@/lib/admin-system-status";
import { auditActionLabel } from "@/lib/audit-action-labels";
import {
  eventTypeLabel, INCIDENT_STATUS_LABELS, ipCheckLight, loginMethodLabel, portalForPath, portalLabel, SEVERITY_LABELS, shownIp,
} from "@/lib/security-center-view";
import {
  loadActiveAdminSessionCount, loadAdminLogins, loadAdmins, loadFailedLoginTrend, loadFailedLogins, loadIncidentsAndHighEvents, loadSecurityAudit, loadSuspicious, recordFullIpView,
} from "@/lib/security-center-data";
import {
  dailyFailedLogins, DASHBOARD_TEXT, deviceText, hourlyFailedLogins, lastBakuDays, securityVerdict, STATUS_TEXT, type StatusLevel,
} from "@/lib/security-center-status";

export const dynamic = "force-dynamic";

const card = "rounded-2xl border border-[#e7e3d9] bg-white p-5";
const th = "px-3 py-2 font-medium";
const td = "px-3 py-2.5 align-top";
const unavailable = <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Məlumat əlçatan deyil.</p>;
const empty = (text: string) => <p className="rounded-xl bg-[#f8f7f4] p-3 text-sm text-slate-500">{text}</p>;
/** A calm "nothing to report" state (icon + text, not colour only). */
const allClear = (text: string) => <p className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900"><CheckCircle2 size={18} aria-hidden="true" className="shrink-0"/>{text}</p>;
const LATEST = 10;

function Block({ title, note, children, wide }: { title: string; note?: string; children: ReactNode; wide?: boolean }) {
  // min-w-0: a grid item must be allowed to shrink below its table's min width (the table scrolls inside), else the
  // whole page overflows on phones (found in the SECURITY-PAGE-1 browser check: 578 px at 390).
  return <section className={`${card} min-w-0${wide ? " xl:col-span-2" : ""}`}>
    <h2 className="font-semibold text-[#0d1b2a]">{title}</h2>
    {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    <div className="mt-3">{children}</div>
  </section>;
}

function Table({ head, children, narrow }: { head: string[]; children: ReactNode; narrow?: boolean }) {
  return <div className="overflow-x-auto"><table className={`w-full ${narrow ? "min-w-[360px]" : "min-w-[520px]"} text-left text-sm`}>
    <thead className="bg-[#f8f7f4] text-xs text-slate-500"><tr>{head.map((title) => <th key={title} className={th}>{title}</th>)}</tr></thead>
    <tbody className="divide-y divide-[#eeeae2]">{children}</tbody>
  </table></div>;
}

/** Status badge: icon + text, never colour alone. */
function Badge({ tone, children }: { tone: "good" | "warn" | "bad" | "neutral"; children: ReactNode }) {
  const style = tone === "good" ? "bg-green-50 text-green-900 ring-green-200" : tone === "warn" ? "bg-amber-50 text-amber-900 ring-amber-200" : tone === "bad" ? "bg-red-50 text-red-800 ring-red-200" : "bg-[#f3f1ec] text-slate-600 ring-[#e7e3d9]";
  const Icon = tone === "good" ? CheckCircle2 : tone === "warn" ? AlertTriangle : tone === "bad" ? XCircle : Clock;
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}><Icon size={12} aria-hidden="true"/>{children}</span>;
}

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

const Ip = ({ value }: { value: string | null }) => <span className="font-mono text-xs">{value ?? "—"}</span>;
const date = (value: Date | null | undefined) => value ? formatBakuDateTime(value) : "—";

/**
 * Security summary (SECURITY-PAGE-1, redesigned in SECURITY-CENTER-DESIGN-1): real data from existing tables only,
 * read-only, no auto-refresh. Full IPs only with ?ip=full and only after an AuditLog row SECURITY_FULL_IP_VIEW was written.
 */
export default async function AdminSecurityCenterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireRole("ADMIN");
  if (!admin || !requireSecurityPermission(admin, "security.view")) redirect("/admin/login");
  const params = await searchParams;
  const wantsFull = (Array.isArray(params.ip) ? params.ip[0] : params.ip) === "full";
  const full = wantsFull ? await recordFullIpView(admin.id, "summary") : false;
  const now = new Date();
  const light = ipCheckLight(clientIpDiagnostics(new Headers(await headers()), process.env.BAGATI_TRUST_CLOUDFLARE_IP === "true"));
  // One block after another: each is its own bounded read-only query (lib/security-center-data.ts).
  const admins = await loadAdmins();
  const logins = await loadAdminLogins(now);
  const activeSessions = await loadActiveAdminSessionCount(now);
  const failed = await loadFailedLogins(now);
  const trend = await loadFailedLoginTrend(now);
  const suspicious = await loadSuspicious(now);
  const incidents = await loadIncidentsAndHighEvents(now);
  const audit = await loadSecurityAudit();

  const failed24h = failed ? failed.byPath.reduce((sum, row) => sum + row.last24h, 0) : null;
  const failedPrev24h = failed ? failed.byPath.reduce((sum, row) => sum + row.prev24h, 0) : null;
  const failed7d = failed ? failed.byPath.reduce((sum, row) => sum + row.last7d, 0) : null;
  const adminFailed24h = failed ? failed.adminTargeted.filter((row) => now.getTime() - row.createdAt.getTime() <= 24 * 60 * 60 * 1000).length : null;
  const verdict = securityVerdict({
    admins,
    failed: failed24h === null || failedPrev24h === null ? null : { last24h: failed24h, prev24h: failedPrev24h },
    adminFailed24h,
    ip: light,
    incidents: incidents ? incidents.incidents : null,
  }, now);
  const banner = BANNER[verdict.level];
  const activeAdmins = admins ? admins.filter((row) => row.isActive) : [];
  const twoFactorOn = activeAdmins.filter((row) => row.twoFactorOn).length;
  const lastLogin = logins?.[0] ?? null;
  const daily = trend ? dailyFailedLogins(trend.daily, lastBakuDays(now, 7)) : null;
  const hourly = trend ? hourlyFailedLogins(trend.hourly, now) : null;
  const loginIp = (row: { ipFull: string | null; ipMasked: string | null }) => full && row.ipFull ? row.ipFull : row.ipMasked ?? (row.ipFull ? maskIpAddress(row.ipFull) : null);
  const ipTone = light.tone;

  const loginRow = (row: NonNullable<typeof logins>[number]) => <tr key={row.id}>
    <td className={td}>{row.email}</td>
    <td className={`${td} whitespace-nowrap`}>{date(row.createdAt)}</td>
    <td className={td}>{loginMethodLabel(row.method)}</td>
    <td className={td}>{row.device ?? "—"}</td>
    <td className={td}><Ip value={loginIp(row)} /></td>
    <td className={td}>{row.active ? <Badge tone="good">Aktiv</Badge> : <Badge tone="neutral">Bağlanıb</Badge>}</td>
  </tr>;
  const failedRow = (row: NonNullable<typeof failed>["recent"][number]) => <tr key={row.id}><td className={`${td} whitespace-nowrap`}>{date(row.occurredAt)}</td><td className={td}>{portalForPath(row.path)}</td><td className={td}><Ip value={shownIp(row.sourceIp, row.sourceIpMasked, full)} /></td></tr>;

  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">BAGATI · ADMIN</p>
        <h1 className="mt-2 text-3xl font-semibold text-[#0d1b2a]">Təhlükəsizlik mərkəzi</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">Bazada qeydə alınmış real məlumat. Səhifə avtomatik yenilənmir.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={full ? "/admin/security-center?ip=full" : "/admin/security-center"} prefetch={false} className="rounded-xl bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173c40]">Yenilə</Link>
        {full
          ? <Link href="/admin/security-center" prefetch={false} className="rounded-xl border border-[#c7ad78] bg-white px-4 py-2.5 text-sm font-semibold text-[#85621d]">IP-ləri gizlət</Link>
          : <form method="get" action="/admin/security-center"><input type="hidden" name="ip" value="full" /><button className="rounded-xl border border-[#c7ad78] bg-white px-4 py-2.5 text-sm font-semibold text-[#85621d]">Tam IP-ləri göstər</button></form>}
      </div>
    </div>
    {wantsFull && !full && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Tam IP-lərə baxış audit jurnalına yazıla bilmədi; IP-lər maskalı qalır.</p>}
    {full && <p role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Tam IP-lər göstərilir. Bu baxış audit jurnalına yazıldı. Tam IP 30 gün saxlanılır, sonra yalnız maskalı forma qalır.</p>}

    {/* 1. Overall verdict (lib/security-center-status.ts securityVerdict: real rules, listed in the report). */}
    <section aria-labelledby="security-verdict" data-security-verdict={verdict.level} className={`mb-5 rounded-2xl border p-5 ${banner.style}`}>
      <div className="flex items-start gap-3">
        <banner.Icon size={28} aria-hidden="true" className="mt-0.5 shrink-0"/>
        <div className="min-w-0">
          <h2 id="security-verdict" className="text-xl font-semibold">{banner.title}</h2>
          {verdict.reasons.length
            ? <ul className="mt-2 space-y-1.5 text-sm">{verdict.reasons.map((reason) => <li key={reason.code} className="flex items-start gap-2">
                {reason.level === "problem" ? <XCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0"/> : <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0"/>}
                <span>{reason.text}</span></li>)}</ul>
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

    {/* 3. Failed logins over time. */}
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

    <div className="grid gap-5 xl:grid-cols-2">
      {/* 4. Admins and 2FA. */}
      <Block wide title="Adminlər və iki mərhələli təsdiq">
        {!admins ? unavailable : !admins.length ? empty("Admin hesabı yoxdur.") : <Table narrow head={["E-poçt", "2FA", "Kilid", "Bərpa kodları"]}>
          {admins.map((row) => <tr key={row.id}>
            <td className={`${td} break-all`}>{row.email}{!row.isActive && <span className="ml-2"><Badge tone="neutral">deaktiv</Badge></span>}</td>
            <td className={td}>{row.twoFactorOn ? <Badge tone="good">Qoşulub</Badge> : <Badge tone={row.isActive ? "bad" : "neutral"}>Qoşulmayıb</Badge>}</td>
            <td className={td}>{row.lockedUntil && row.lockedUntil > now ? <Badge tone="warn">{date(row.lockedUntil)} qədər</Badge> : "—"}</td>
            <td className={td}>{row.twoFactorOn ? `${row.unusedRecoveryCodes} / 10` : "—"}</td>
          </tr>)}
        </Table>}
        <Link href="/admin/security" className="mt-3 inline-block text-sm font-medium text-[#85621d] underline">Hesab təhlükəsizliyi →</Link>
      </Block>

      {/* 5. Recent admin logins: the latest 10, the rest behind "show more" (no script). */}
      <Block wide title="Son admin girişləri" note="Bütün adminlər, ən yenisi əvvəldə. Tam IP bu yenilənmədən sonrakı girişlər üçün mövcuddur.">
        {!logins ? unavailable : !logins.length ? empty("Admin girişi qeydə alınmayıb.") : <>
          <Table head={["Kim", "Nə vaxt", "Necə", "Cihaz", "IP", "Vəziyyət"]}>{logins.slice(0, LATEST).map(loginRow)}</Table>
          {logins.length > LATEST && <details className="mt-3 group"><summary className="cursor-pointer text-sm font-medium text-[#85621d] underline">{DASHBOARD_TEXT.showMore(logins.length - LATEST)}</summary>
            <div className="mt-3"><Table head={["Kim", "Nə vaxt", "Necə", "Cihaz", "IP", "Vəziyyət"]}>{logins.slice(LATEST).map(loginRow)}</Table></div>
          </details>}
        </>}
      </Block>

      {/* 6. Failed logins: by login type, admin accounts, latest attempts. */}
      <Block wide title="Uğursuz girişlər" note="Giriş səhifəsinə görə: son 24 saat / son 7 gün.">
        {!failed ? unavailable : <>
          {!failed.byPath.length ? allClear("Son 7 gündə uğursuz giriş yoxdur.") : <Table head={["Giriş", "24 saat", "7 gün"]}>
            {failed.byPath.map((row) => <tr key={row.path ?? "none"}><td className={td}>{portalForPath(row.path)}</td><td className={td}>{row.last24h}</td><td className={td}>{row.last7d}</td></tr>)}
          </Table>}
          {failed.adminTargeted.length > 0 && <>
            <h3 className="mt-4 text-sm font-semibold">Admin hesablarına cəhdlər</h3>
            <Table head={["Hesab", "Nə vaxt", "Harada", "IP"]}>
              {failed.adminTargeted.map((row) => <tr key={row.id}><td className={td}>{row.email ?? "—"}</td><td className={td}>{date(row.createdAt)}</td><td className={td}>{portalLabel(row.portal)}</td><td className={td}><Ip value={row.ip ? (full ? row.ip : maskIpAddress(row.ip)) : null} /></td></tr>)}
            </Table>
          </>}
          {failed.recent.length > 0 && <>
            <h3 className="mt-4 text-sm font-semibold">Son uğursuz girişlər</h3>
            <Table head={["Nə vaxt", "Giriş", "IP"]}>{failed.recent.slice(0, 5).map(failedRow)}</Table>
            {failed.recent.length > 5 && <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-[#85621d] underline">{DASHBOARD_TEXT.showMore(failed.recent.length - 5)}</summary>
              <div className="mt-3"><Table head={["Nə vaxt", "Giriş", "IP"]}>{failed.recent.slice(5).map(failedRow)}</Table></div>
            </details>}
          </>}
        </>}
      </Block>

      <Block wide title="Şübhəli fəaliyyət" note="404 skanları sayğaclardır (IP saxlanmır); IP siyahısı qeydə alınmış hadisələrdəndir.">
        {!suspicious ? unavailable : <>
          <Table head={["Nə", "24 saat", "7 gün"]}>
            {suspicious.notFound.map((row) => <tr key={row.group}><td className={td}>{row.label}</td><td className={td}>{row.last24h}</td><td className={td}>{row.last7d}</td></tr>)}
            <tr><td className={td}>Limit aşımı</td><td className={td}>{suspicious.rateLimited.last24h}</td><td className={td}>{suspicious.rateLimited.last7d}</td></tr>
            <tr><td className={td}>IP başlıqları uyğun gəlmir</td><td className={td}>{suspicious.ipMismatches.last24h}</td><td className={td}>{suspicious.ipMismatches.last7d}</td></tr>
          </Table>
          <h3 className="mt-4 text-sm font-semibold">Ən çox qeydə alınan IP-lər (7 gün)</h3>
          {!suspicious.topIps.length ? empty("Qeydə alınmış IP yoxdur.") : <Table head={["IP", "Say", "Nə etdi", "Son"]}>
            {/* Key by position, never by row.key: that is the RAW IP, and React keys end up in the page's embedded data
                even when the IP shown is masked (found in the live check). */}
            {suspicious.topIps.map((row, index) => <tr key={`top-ip-${index}`}>
              <td className={td}><Ip value={shownIp(row.raw, row.masked, full)} /></td>
              <td className={td}>{row.count}</td>
              <td className={td}>{row.eventTypes.map(eventTypeLabel).join(", ")}{row.paths.length > 0 && <span className="mt-1 block font-mono text-xs text-slate-500">{row.paths.map((item) => `${item.path ?? "—"} (${item.count})`).join(", ")}</span>}</td>
              <td className={td}>{date(row.latestAt)}</td>
            </tr>)}
          </Table>}
        </>}
      </Block>

      <Block wide title="İnsidentlər və yüksək riskli hadisələr">
        {!incidents ? unavailable : <>
          {!incidents.incidents.length ? allClear("Açıq insident yoxdur.") : <ul className="space-y-2">{incidents.incidents.map((row) => <li key={row.id} className="rounded-xl bg-[#f8f7f4] px-3 py-2 text-sm">
            <span className="font-medium">{row.title}</span>
            <span className="ml-2 text-xs text-slate-500">{SEVERITY_LABELS[row.severity] ?? row.severity} · {INCIDENT_STATUS_LABELS[row.status] ?? row.status} · {date(row.createdAt)}</span>
          </li>)}</ul>}
          <Link href="/admin/security-center/incidents" className="mt-3 inline-block text-sm font-medium text-[#85621d] underline">İnsidentlər və qaydalar →</Link>
          <h3 className="mt-4 text-sm font-semibold">Yüksək riskli hadisələr (7 gün)</h3>
          {!incidents.high.length ? empty("Yüksək riskli hadisə yoxdur.") : <Table head={["Nə vaxt", "Hadisə", "Yer", "IP"]}>
            {incidents.high.map((row) => <tr key={row.id}><td className={td}>{date(row.occurredAt)}</td><td className={td}>{eventTypeLabel(row.eventType)}</td><td className={td}><span className="font-mono text-xs">{row.path ?? "—"}</span></td><td className={td}><Ip value={shownIp(row.sourceIp, row.sourceIpMasked, full)} /></td></tr>)}
          </Table>}
          <Link href={full ? "/admin/security-center/events?ip=full" : "/admin/security-center/events"} prefetch={false} className="mt-3 inline-block text-sm font-medium text-[#85621d] underline">Ətraflı hadisələr →</Link>
        </>}
      </Block>

      <Block wide title="Son təhlükəsizlik əməliyyatları">
        {!audit ? unavailable : !audit.length ? empty("Qeyd yoxdur.") : <Table head={["Nə vaxt", "Kim", "Əməl"]}>
          {audit.map((row) => <tr key={row.id}><td className={td}>{date(row.createdAt)}</td><td className={td}>{row.actor?.email ?? "Sistem"}</td><td className={td}>{auditActionLabel(row.action)}</td></tr>)}
        </Table>}
        <Link href="/admin/audit-log" className="mt-3 inline-block text-sm font-medium text-[#85621d] underline">Audit jurnalı →</Link>
      </Block>

      {/* 7. Related pages (existing page titles as link texts). */}
      <section className={`${card} min-w-0 xl:col-span-2`} aria-labelledby="related-pages">
        <h2 id="related-pages" className="font-semibold text-[#0d1b2a]">{DASHBOARD_TEXT.relatedPages}</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {[
            ["/admin/security/sessions", "Aktiv sessiyalar"], ["/admin/audit-log", "Audit jurnalı"], ["/admin/system", "Sistem vəziyyəti"],
            ["/admin/system", "Saxtalaşdırma testi"], ["/admin/security", "Hesab təhlükəsizliyi"], ["/admin/security-center/events", "Ətraflı hadisələr"],
            ["/admin/security-center/incidents", "İnsidentlər və qaydalar"],
          ].map(([href, label]) => <li key={label}><Link href={href} prefetch={false} className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-[#e7e3d9] px-3 py-2 text-sm font-medium text-[#0d1b2a] hover:border-[#c7ad78] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173c40]">{label}<ChevronRight size={16} aria-hidden="true" className="shrink-0 text-[#85621d]"/></Link></li>)}
        </ul>
      </section>
    </div>
  </AdminShell>;
}
