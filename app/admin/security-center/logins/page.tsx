import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { allClear, Badge, Block, date, empty, FullIpNotice, FullIpToggle, Ip, LimitedRows, linkClass, RowTable, SecurityCenterHeader, unavailable } from "@/components/security-center-ui";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import { requireRole } from "@/lib/auth";
import { requireSecurityPermission } from "@/lib/security-monitoring/permissions";
import { maskIpAddress } from "@/lib/admin-system-status";
import { loginMethodLabel, portalForPath, portalLabel, shownIp } from "@/lib/security-center-view";
import { loadAdminLogins, loadAdmins, loadFailedLogins, recordFullIpView } from "@/lib/security-center-data";
import { CENTER_TEXT, DASHBOARD_TEXT, deviceText } from "@/lib/security-center-status";

export const dynamic = "force-dynamic";

const LATEST = 10;
const FEW = 5;

/**
 * "Girişlər" tab (SECURITY-CENTER-DESIGN-2): the admins and their 2FA, the latest admin logins and the failed logins,
 * moved here from the overview. Read-only, bounded (the same loaders as before); IPs masked unless ?ip=full was audited.
 */
export default async function AdminSecurityLoginsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireRole("ADMIN");
  if (!admin || !requireSecurityPermission(admin, "security.view")) redirect("/admin/login");
  const params = await searchParams;
  const wantsFull = (Array.isArray(params.ip) ? params.ip[0] : params.ip) === "full";
  const full = wantsFull ? await recordFullIpView(admin.id, "logins") : false;
  const now = new Date();
  const admins = await loadAdmins();
  const logins = await loadAdminLogins(now);
  const failed = await loadFailedLogins(now);
  const loginIp = (row: { ipFull: string | null; ipMasked: string | null }) => full && row.ipFull ? row.ipFull : row.ipMasked ?? (row.ipFull ? maskIpAddress(row.ipFull) : null);

  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}>
    <SecurityCenterHeader active="logins" renderedAt={now.toISOString()} fullIp={full} actions={<FullIpToggle action="/admin/security-center/logins" full={full}/>}/>
    <FullIpNotice wanted={wantsFull} full={full}/>
    <div className="grid gap-5">
      <Block title="Adminlər və iki mərhələli təsdiq">
        {!admins ? unavailable : !admins.length ? empty("Admin hesabı yoxdur.") : <RowTable head={["E-poçt", "2FA", "Kilid", "Bərpa kodları"]}
          rows={admins.map((row) => ({ key: row.id, cells: [
            <span key="e" className="break-all">{row.email}{!row.isActive && <span className="ml-2"><Badge tone="neutral">deaktiv</Badge></span>}</span>,
            row.twoFactorOn ? <Badge key="t" tone="good">Qoşulub</Badge> : <Badge key="t" tone={row.isActive ? "bad" : "neutral"}>Qoşulmayıb</Badge>,
            row.lockedUntil && row.lockedUntil > now ? <Badge key="l" tone="warn">{date(row.lockedUntil)} qədər</Badge> : "—",
            row.twoFactorOn ? `${row.unusedRecoveryCodes} / 10` : "—",
          ] }))}/>}
        <Link href="/admin/security" className={`mt-3 inline-block ${linkClass}`}>Hesab təhlükəsizliyi →</Link>
      </Block>

      <Block title="Son admin girişləri" note="Bütün adminlər, ən yenisi əvvəldə. Tam IP bu yenilənmədən sonrakı girişlər üçün mövcuddur.">
        {!logins ? unavailable : !logins.length ? empty("Admin girişi qeydə alınmayıb.") : <LimitedRows limit={LATEST} more={DASHBOARD_TEXT.showMore} head={["Kim", "Nə vaxt", "Necə", "Cihaz", "IP", "Vəziyyət"]}
          rows={logins.map((row) => ({ key: row.id, cells: [
            <span key="e" className="break-all">{row.email}</span>, <span key="d" className="whitespace-nowrap">{date(row.createdAt)}</span>, loginMethodLabel(row.method), deviceText(row.device),
            <Ip key="ip" value={loginIp(row)} />, row.active ? <Badge key="s" tone="good">Aktiv</Badge> : <Badge key="s" tone="neutral">Bağlanıb</Badge>,
          ] }))}/>}
        <Link href="/admin/security/sessions" prefetch={false} className={`mt-3 inline-block ${linkClass}`}>{CENTER_TEXT.allSessions}</Link>
      </Block>

      <Block title="Uğursuz girişlər" note="Giriş səhifəsinə görə: son 24 saat / son 7 gün.">
        {!failed ? unavailable : <>
          {!failed.byPath.length ? allClear("Son 7 gündə uğursuz giriş yoxdur.") : <RowTable head={["Giriş", "24 saat", "7 gün"]}
            rows={failed.byPath.map((row, index) => ({ key: `path-${index}`, cells: [portalForPath(row.path), row.last24h, row.last7d] }))}/>}
          {failed.adminTargeted.length > 0 && <>
            <h3 className="mt-5 text-sm font-semibold">Admin hesablarına cəhdlər</h3>
            <div className="mt-2"><LimitedRows limit={FEW} more={DASHBOARD_TEXT.showMore} head={["Hesab", "Nə vaxt", "Harada", "IP"]}
              rows={failed.adminTargeted.map((row) => ({ key: row.id, cells: [row.email ?? "—", date(row.createdAt), portalLabel(row.portal), <Ip key="ip" value={row.ip ? (full ? row.ip : maskIpAddress(row.ip)) : null} />] }))}/></div>
          </>}
          {failed.recent.length > 0 && <>
            <h3 className="mt-5 text-sm font-semibold">Son uğursuz girişlər</h3>
            <div className="mt-2"><LimitedRows limit={FEW} more={DASHBOARD_TEXT.showMore} head={["Nə vaxt", "Giriş", "IP"]}
              rows={failed.recent.map((row) => ({ key: row.id, cells: [<span key="d" className="whitespace-nowrap">{date(row.occurredAt)}</span>, portalForPath(row.path), <Ip key="ip" value={shownIp(row.sourceIp, row.sourceIpMasked, full)} />] }))}/></div>
          </>}
        </>}
      </Block>
    </div>
  </AdminShell>;
}
