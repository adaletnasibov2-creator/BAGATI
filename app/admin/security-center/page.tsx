import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import AdminShell from "@/components/admin-shell";
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
  loadAdminLogins, loadAdmins, loadFailedLogins, loadIncidentsAndHighEvents, loadSecurityAudit, loadSuspicious, recordFullIpView,
} from "@/lib/security-center-data";

export const dynamic = "force-dynamic";

const card = "rounded-2xl border border-[#e7e3d9] bg-white p-5";
const th = "px-3 py-2 font-medium";
const td = "px-3 py-2.5 align-top";
const unavailable = <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Məlumat əlçatan deyil.</p>;
const empty = (text: string) => <p className="rounded-xl bg-[#f8f7f4] p-3 text-sm text-slate-500">{text}</p>;

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

const Ip = ({ value }: { value: string | null }) => <span className="font-mono text-xs">{value ?? "—"}</span>;
const date = (value: Date | null | undefined) => value ? formatBakuDateTime(value) : "—";

/**
 * Security summary (SECURITY-PAGE-1): real data from existing tables only, read-only, no auto-refresh.
 * Full IPs only with ?ip=full and only after an AuditLog row SECURITY_FULL_IP_VIEW was written.
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
  const failed = await loadFailedLogins(now);
  const suspicious = await loadSuspicious(now);
  const incidents = await loadIncidentsAndHighEvents(now);
  const audit = await loadSecurityAudit();
  const lightClass = light.tone === "good" ? "border-green-200 bg-green-50 text-green-900" : light.tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-red-200 bg-red-50 text-red-800";

  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">BAGATI · ADMIN</p>
        <h1 className="mt-2 text-3xl font-semibold text-[#0d1b2a]">Təhlükəsizlik mərkəzi</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">Bazada qeydə alınmış real məlumat. Səhifə avtomatik yenilənmir.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={full ? "/admin/security-center?ip=full" : "/admin/security-center"} prefetch={false} className="rounded-xl bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white">Yenilə</Link>
        {full
          ? <Link href="/admin/security-center" prefetch={false} className="rounded-xl border border-[#c7ad78] bg-white px-4 py-2.5 text-sm font-semibold text-[#85621d]">IP-ləri gizlət</Link>
          : <form method="get" action="/admin/security-center"><input type="hidden" name="ip" value="full" /><button className="rounded-xl border border-[#c7ad78] bg-white px-4 py-2.5 text-sm font-semibold text-[#85621d]">Tam IP-ləri göstər</button></form>}
      </div>
    </div>
    {wantsFull && !full && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Tam IP-lərə baxış audit jurnalına yazıla bilmədi; IP-lər maskalı qalır.</p>}
    {full && <p role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Tam IP-lər göstərilir. Bu baxış audit jurnalına yazıldı. Tam IP 30 gün saxlanılır, sonra yalnız maskalı forma qalır.</p>}

    <div className="grid gap-5 xl:grid-cols-2">
      <Block title="IP yoxlaması">
        <div className={`rounded-xl border p-3 text-sm ${lightClass}`}><p className="font-semibold">{light.title}</p><p className="mt-1">{light.detail}</p></div>
        <Link href="/admin/system" className="mt-3 inline-block text-sm font-medium text-[#85621d] underline">Sistem vəziyyəti → Müştəri IP başlıqları və saxtalaşdırma testi</Link>
      </Block>

      <Block title="Adminlər və iki mərhələli təsdiq">
        {!admins ? unavailable : !admins.length ? empty("Admin hesabı yoxdur.") : <Table narrow head={["E-poçt", "2FA", "Kilid", "Bərpa kodları"]}>
          {admins.map((row) => <tr key={row.id}>
            <td className={td}>{row.email}{!row.isActive && <span className="ml-2 text-xs text-red-700">deaktiv</span>}</td>
            <td className={`${td} ${row.twoFactorOn ? "text-green-800" : "font-semibold text-red-700"}`}>{row.twoFactorOn ? "Qoşulub" : "Qoşulmayıb"}</td>
            <td className={td}>{row.lockedUntil && row.lockedUntil > now ? <span className="text-red-700">{date(row.lockedUntil)} qədər</span> : "—"}</td>
            <td className={td}>{row.twoFactorOn ? `${row.unusedRecoveryCodes} / 10` : "—"}</td>
          </tr>)}
        </Table>}
        <Link href="/admin/security" className="mt-3 inline-block text-sm font-medium text-[#85621d] underline">Hesab təhlükəsizliyi →</Link>
      </Block>

      <Block wide title="Son admin girişləri" note="Bütün adminlər, ən yenisi əvvəldə. Tam IP bu yenilənmədən sonrakı girişlər üçün mövcuddur.">
        {!logins ? unavailable : !logins.length ? empty("Admin girişi qeydə alınmayıb.") : <Table head={["Kim", "Nə vaxt", "Necə", "Cihaz", "IP", "Vəziyyət"]}>
          {logins.map((row) => <tr key={row.id}>
            <td className={td}>{row.email}</td>
            <td className={td}>{date(row.createdAt)}</td>
            <td className={td}>{loginMethodLabel(row.method)}</td>
            <td className={td}>{row.device ?? "—"}</td>
            <td className={td}><Ip value={full && row.ipFull ? row.ipFull : row.ipMasked ?? (row.ipFull ? maskIpAddress(row.ipFull) : null)} /></td>
            <td className={`${td} ${row.active ? "text-green-800" : "text-slate-500"}`}>{row.active ? "Aktiv" : "Bağlanıb"}</td>
          </tr>)}
        </Table>}
      </Block>

      <Block wide title="Uğursuz girişlər" note="Giriş səhifəsinə görə: son 24 saat / son 7 gün.">
        {!failed ? unavailable : <>
          {!failed.byPath.length ? empty("Son 7 gündə uğursuz giriş yoxdur.") : <Table head={["Giriş", "24 saat", "7 gün"]}>
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
            <Table head={["Nə vaxt", "Giriş", "IP"]}>
              {failed.recent.map((row) => <tr key={row.id}><td className={td}>{date(row.occurredAt)}</td><td className={td}>{portalForPath(row.path)}</td><td className={td}><Ip value={shownIp(row.sourceIp, row.sourceIpMasked, full)} /></td></tr>)}
            </Table>
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
            {suspicious.topIps.map((row) => <tr key={row.key}>
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
          {!incidents.incidents.length ? empty("Açıq insident yoxdur.") : <ul className="space-y-2">{incidents.incidents.map((row) => <li key={row.id} className="rounded-xl bg-[#f8f7f4] px-3 py-2 text-sm">
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
    </div>
  </AdminShell>;
}
