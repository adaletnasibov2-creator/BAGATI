import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import { requireRole } from "@/lib/auth";
import { requireSecurityPermission } from "@/lib/security-monitoring/permissions";
import { formatBakuDateTime } from "@/lib/admin-audit-log";
import { EVENT_TYPE_LABELS, EVENTS_PAGE_SIZE, eventTypeLabel, parseEventFilters, portalForPath, PRODUCED_EVENT_TYPES, SEVERITY_LABELS, shownIp } from "@/lib/security-center-view";
import { listSecurityEvents, recordFullIpView } from "@/lib/security-center-data";

export const dynamic = "force-dynamic";

const card = "rounded-2xl border border-[#e7e3d9] bg-white p-5";
const field = "min-h-10 rounded-xl border border-[#ded9cf] bg-white px-3 text-sm";
const td = "px-3 py-2.5 align-top";
const WINDOW_LABELS = { "24h": "Son 24 saat", "7d": "Son 7 gün", "30d": "Son 30 gün" } as const;

/** "Ətraflı hadisələr" (SECURITY-PAGE-1): the stored security events with filters; read-only, 50 per page. */
export default async function AdminSecurityEventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireRole("ADMIN");
  if (!admin || !requireSecurityPermission(admin, "security.view")) redirect("/admin/login");
  const filters = parseEventFilters(await searchParams);
  const full = filters.fullIp ? await recordFullIpView(admin.id, "events") : false;
  const result = await listSecurityEvents(filters, new Date());
  const pages = result ? Math.max(1, Math.ceil(result.total / EVENTS_PAGE_SIZE)) : 1;
  const query = (page: number) => {
    const params = new URLSearchParams({ window: filters.window, ...(filters.eventType ? { type: filters.eventType } : {}), ...(filters.severity ? { severity: filters.severity } : {}), ...(filters.q ? { q: filters.q } : {}), ...(full ? { ip: "full" } : {}), page: String(page) });
    return `/admin/security-center/events?${params.toString()}`;
  };

  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}>
    <div className="mb-6">
      <Link href="/admin/security-center" className="text-sm font-medium text-[#85621d]">← Təhlükəsizlik mərkəzi</Link>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">BAGATI · ADMIN</p>
      <h1 className="mt-2 text-3xl font-semibold text-[#0d1b2a]">Ətraflı hadisələr</h1>
      <p className="mt-2 text-sm text-slate-500">Tətbiqin qeydə aldığı uğursuz girişlər, limit aşımları və IP başlıqlarının uyğunsuzluğu.</p>
    </div>
    <form method="get" action="/admin/security-center/events" className={`${card} mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5`}>
      <label className="grid gap-1 text-sm">Müddət<select name="window" defaultValue={filters.window} className={field}>{Object.entries(WINDOW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Hadisə<select name="type" defaultValue={filters.eventType} className={field}><option value="">Hamısı</option>{PRODUCED_EVENT_TYPES.map((type) => <option key={type} value={type}>{EVENT_TYPE_LABELS[type]}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Risk<select name="severity" defaultValue={filters.severity} className={field}><option value="">Hamısı</option>{Object.entries(SEVERITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Yol və ya IP<input name="q" defaultValue={filters.q} maxLength={100} className={field} /></label>
      <div className="flex items-end gap-2">
        {full && <input type="hidden" name="ip" value="full" />}
        <button className="min-h-10 rounded-xl bg-[#173c40] px-4 text-sm font-semibold text-white">Göstər</button>
      </div>
    </form>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-slate-500">{result ? `${result.total} hadisə` : ""}</p>
      {full
        ? <a href={query(filters.page).replace("&ip=full", "")} className="rounded-xl border border-[#c7ad78] bg-white px-4 py-2 font-semibold text-[#85621d]">IP-ləri gizlət</a>
        : <a href={`${query(filters.page)}&ip=full`} className="rounded-xl border border-[#c7ad78] bg-white px-4 py-2 font-semibold text-[#85621d]">Tam IP-ləri göstər</a>}
    </div>
    {filters.fullIp && !full && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Tam IP-lərə baxış audit jurnalına yazıla bilmədi; IP-lər maskalı qalır.</p>}
    {!result ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Məlumat əlçatan deyil.</p>
      : !result.rows.length ? <p className="rounded-xl bg-[#f8f7f4] p-3 text-sm text-slate-500">Bu süzgəclərlə hadisə yoxdur.</p>
        : <div className="overflow-x-auto rounded-2xl border border-[#e7e3d9] bg-white"><table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[#f8f7f4] text-xs text-slate-500"><tr>{["Nə vaxt (Bakı)", "Hadisə", "Risk", "Yer", "IP"].map((title) => <th key={title} className="px-3 py-2 font-medium">{title}</th>)}</tr></thead>
          <tbody className="divide-y divide-[#eeeae2]">{result.rows.map((row) => <tr key={row.id}>
            <td className={td}>{formatBakuDateTime(row.occurredAt)}</td>
            <td className={td}>{eventTypeLabel(row.eventType)}</td>
            <td className={td}>{SEVERITY_LABELS[row.severity] ?? row.severity}</td>
            <td className={td}>{portalForPath(row.path)}{row.path && portalForPath(row.path) !== row.path && <span className="block font-mono text-xs text-slate-500">{row.path}</span>}</td>
            <td className={td}><span className="font-mono text-xs">{shownIp(row.sourceIp, row.sourceIpMasked, full) ?? "—"}</span></td>
          </tr>)}</tbody>
        </table></div>}
    {result && pages > 1 && <nav className="mt-4 flex items-center justify-between text-sm">
      {filters.page > 1 ? <a href={query(filters.page - 1)} className="rounded-xl border px-4 py-2">Əvvəlki</a> : <span />}
      <span className="text-slate-500">{filters.page} / {pages}</span>
      {filters.page < pages ? <a href={query(filters.page + 1)} className="rounded-xl border px-4 py-2">Növbəti</a> : <span />}
    </nav>}
  </AdminShell>;
}
