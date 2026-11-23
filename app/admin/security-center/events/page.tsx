import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { Block, date, empty, Ip, LimitedRows, RowTable, SecurityCenterHeader, unavailable } from "@/components/security-center-ui";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import { requireRole } from "@/lib/auth";
import { requireSecurityPermission } from "@/lib/security-monitoring/permissions";
import { EVENT_TYPE_LABELS, EVENTS_PAGE_SIZE, eventTypeLabel, parseEventFilters, portalForPath, PRODUCED_EVENT_TYPES, SEVERITY_LABELS, shownIp } from "@/lib/security-center-view";
import { listSecurityEvents, loadSuspicious, recordFullIpView } from "@/lib/security-center-data";
import { DASHBOARD_TEXT } from "@/lib/security-center-status";

export const dynamic = "force-dynamic";

const card = "rounded-2xl border border-[#e7e3d9] bg-white p-5";
const field = "min-h-11 rounded-xl border border-[#ded9cf] bg-white px-3 text-sm";
const WINDOW_LABELS = { "24h": "Son 24 saat", "7d": "Son 7 gün", "30d": "Son 30 gün" } as const;
const FEW = 5;

/**
 * "Hadisələr" tab: "Şübhəli fəaliyyət" (counters + the busiest IPs, moved from the overview in SECURITY-CENTER-DESIGN-2)
 * and "Ətraflı hadisələr" (SECURITY-PAGE-1): the stored security events with filters; read-only, 10 per page.
 */
export default async function AdminSecurityEventsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireRole("ADMIN");
  if (!admin || !requireSecurityPermission(admin, "security.view")) redirect("/admin/login");
  const filters = parseEventFilters(await searchParams);
  const full = filters.fullIp ? await recordFullIpView(admin.id, "events") : false;
  const now = new Date();
  const suspicious = await loadSuspicious(now);
  const result = await listSecurityEvents(filters, now);
  const pages = result ? Math.max(1, Math.ceil(result.total / EVENTS_PAGE_SIZE)) : 1;
  const query = (page: number) => {
    const params = new URLSearchParams({ window: filters.window, ...(filters.eventType ? { type: filters.eventType } : {}), ...(filters.severity ? { severity: filters.severity } : {}), ...(filters.q ? { q: filters.q } : {}), ...(full ? { ip: "full" } : {}), page: String(page) });
    return `/admin/security-center/events?${params.toString()}`;
  };
  const reveal = full
    ? <a href={query(filters.page).replace("&ip=full", "")} className="inline-flex min-h-11 items-center rounded-xl border border-[#c7ad78] bg-white px-4 text-sm font-semibold text-[#85621d]">IP-ləri gizlət</a>
    : <a href={`${query(filters.page)}&ip=full`} className="inline-flex min-h-11 items-center rounded-xl border border-[#c7ad78] bg-white px-4 text-sm font-semibold text-[#85621d]">Tam IP-ləri göstər</a>;

  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}>
    <SecurityCenterHeader active="events" renderedAt={now.toISOString()} fullIp={full} actions={reveal}/>
    {filters.fullIp && !full && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">Tam IP-lərə baxış audit jurnalına yazıla bilmədi; IP-lər maskalı qalır.</p>}

    <div className="mb-5"><Block title="Şübhəli fəaliyyət" note="404 skanları sayğaclardır (IP saxlanmır); IP siyahısı qeydə alınmış hadisələrdəndir.">
      {!suspicious ? unavailable : <div className="grid gap-5 xl:grid-cols-2">
        <div className="min-w-0"><RowTable head={["Nə", "24 saat", "7 gün"]} rows={[
          ...suspicious.notFound.map((row) => ({ key: row.group, cells: [row.label, row.last24h, row.last7d] })),
          { key: "rate-limited", cells: ["Limit aşımı", suspicious.rateLimited.last24h, suspicious.rateLimited.last7d] },
          { key: "ip-mismatch", cells: ["IP başlıqları uyğun gəlmir", suspicious.ipMismatches.last24h, suspicious.ipMismatches.last7d] },
        ]}/></div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Ən çox qeydə alınan IP-lər (7 gün)</h3>
          <div className="mt-2">{!suspicious.topIps.length ? empty("Qeydə alınmış IP yoxdur.") : <LimitedRows limit={FEW} more={DASHBOARD_TEXT.showMore} head={["IP", "Say", "Nə etdi", "Son"]}
            // Key by position, never by row.key: that is the RAW IP, and React keys end up in the page's embedded
            // data even when the IP shown is masked (found in the DESIGN-1 live check).
            rows={suspicious.topIps.map((row, index) => ({ key: `top-ip-${index}`, cells: [
              <Ip key="ip" value={shownIp(row.raw, row.masked, full)} />, row.count,
              <span key="w">{row.eventTypes.map(eventTypeLabel).join(", ")}{row.paths.length > 0 && <span className="mt-1 block break-all font-mono text-xs text-slate-500">{row.paths.map((item) => `${item.path ?? "—"} (${item.count})`).join(", ")}</span>}</span>,
              date(row.latestAt),
            ] }))}/>}</div>
        </div>
      </div>}
    </Block></div>

    <section className="min-w-0" aria-labelledby="events-title">
      <h2 id="events-title" className="font-semibold text-[#0d1b2a]">Ətraflı hadisələr</h2>
      <p className="mt-1 text-sm text-slate-500">Tətbiqin qeydə aldığı uğursuz girişlər, limit aşımları və IP başlıqlarının uyğunsuzluğu.</p>
      <form method="get" action="/admin/security-center/events" className={`${card} my-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5`}>
        <label className="grid gap-1 text-sm">Müddət<select name="window" defaultValue={filters.window} className={field}>{Object.entries(WINDOW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Hadisə<select name="type" defaultValue={filters.eventType} className={field}><option value="">Hamısı</option>{PRODUCED_EVENT_TYPES.map((type) => <option key={type} value={type}>{EVENT_TYPE_LABELS[type]}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Risk<select name="severity" defaultValue={filters.severity} className={field}><option value="">Hamısı</option>{Object.entries(SEVERITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="grid gap-1 text-sm">Yol və ya IP<input name="q" defaultValue={filters.q} maxLength={100} className={field} /></label>
        <div className="flex items-end gap-2">
          {full && <input type="hidden" name="ip" value="full" />}
          <button className="min-h-11 rounded-xl bg-[#173c40] px-4 text-sm font-semibold text-white">Göstər</button>
        </div>
      </form>
      <p className="mb-3 text-sm text-slate-500">{result ? `${result.total} hadisə` : ""}</p>
      {!result ? unavailable
        : !result.rows.length ? empty("Bu süzgəclərlə hadisə yoxdur.")
          : <div className={card}><RowTable head={["Nə vaxt (Bakı)", "Hadisə", "Risk", "Yer", "IP"]} rows={result.rows.map((row) => ({ key: row.id, cells: [
              <span key="d" className="whitespace-nowrap">{date(row.occurredAt)}</span>,
              eventTypeLabel(row.eventType),
              SEVERITY_LABELS[row.severity] ?? row.severity,
              <span key="p">{portalForPath(row.path)}{row.path && portalForPath(row.path) !== row.path && <span className="block break-all font-mono text-xs text-slate-500">{row.path}</span>}</span>,
              <Ip key="ip" value={shownIp(row.sourceIp, row.sourceIpMasked, full)} />,
            ] }))}/></div>}
      {result && pages > 1 && <nav className="mt-4 flex items-center justify-between text-sm">
        {filters.page > 1 ? <a href={query(filters.page - 1)} className="inline-flex min-h-11 items-center rounded-xl border border-[#e7e3d9] px-4">Əvvəlki</a> : <span />}
        <span className="text-slate-500">{filters.page} / {pages}</span>
        {filters.page < pages ? <a href={query(filters.page + 1)} className="inline-flex min-h-11 items-center rounded-xl border border-[#e7e3d9] px-4">Növbəti</a> : <span />}
      </nav>}
    </section>
  </AdminShell>;
}
