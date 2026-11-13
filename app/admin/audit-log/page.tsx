import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import AdminAuditExportButton from "@/components/admin-audit-export-button";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeAdminPage, normalizeAdminSearchParams, type AdminSearchParams } from "@/lib/admin-pagination";
import { AUDIT_EXPORT_MAX_ROWS, AUDIT_LOG_PAGE_SIZE, auditFiltersToSearchParams, formatBakuDateTime, parseAuditLogFilters, type AuditLogFilters } from "@/lib/admin-audit-log";
import { auditDistinctValues, findAuditLogPage, type AuditLogRow } from "@/lib/admin-audit-log-query";

export const dynamic = "force-dynamic";

const card = "rounded-2xl border border-[#e7e3d9] bg-white p-5";
const input = "rounded-lg border border-[#ded9cf] bg-white px-3 py-2.5 text-sm text-slate-800";
const label = "grid min-w-0 gap-1 text-xs text-slate-500";

function actorInputValue(filters: AuditLogFilters) {
  if (!filters.actor) return "";
  return filters.actor.kind === "system" ? "system" : filters.actor.value;
}

function Select({ name, title, values, selected }: { name: string; title: string; values: string[]; selected?: string }) {
  const options = selected && !values.includes(selected) ? [selected, ...values] : values;
  return <label className={label}>{title}<select name={name} defaultValue={selected ?? ""} className={input}>
    <option value="">Hamısı</option>
    {options.map((value) => <option key={value} value={value}>{value}</option>)}
  </select></label>;
}

function Pager({ page, total, query }: { page: number; total: number; query: string }) {
  const pages = Math.max(1, Math.ceil(total / AUDIT_LOG_PAGE_SIZE));
  if (pages < 2) return <p className="mt-3 text-xs text-slate-500">{total} nəticə</p>;
  const href = (n: number) => `/admin/audit-log?${query ? `${query}&` : ""}page=${n}`;
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
    <span className="text-slate-500">Səhifə {Math.min(page, pages)} / {pages} · {total} nəticə</span>
    <div className="flex gap-2">
      {page > 1 && <Link className="rounded-lg border bg-white px-3 py-2" href={href(Math.min(page - 1, pages))}>Əvvəlki</Link>}
      {page < pages && <Link className="rounded-lg border bg-white px-3 py-2" href={href(page + 1)}>Növbəti</Link>}
    </div>
  </div>;
}

function AuditTable({ rows }: { rows: AuditLogRow[] }) {
  if (!rows.length) return <div className={card}><p className="text-sm text-slate-500">Qeyd yoxdur.</p></div>;
  return <div className="overflow-x-auto rounded-2xl border border-[#e7e3d9] bg-white">
    <table className="w-full min-w-[720px] text-left text-sm">
      <thead className="bg-[#f8f7f4] text-xs uppercase tracking-wide text-slate-500">
        <tr>{["Tarix (Bakı)", "İstifadəçi", "Əməl", "Obyekt", "Əlavə məlumat"].map((title) => <th key={title} className="px-4 py-3 font-medium">{title}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-[#eeeae2]">{rows.map((row) => <tr key={row.id} className="align-top">
        <td className="px-4 py-3.5"><time dateTime={row.createdAt.toISOString()} className="whitespace-nowrap">{formatBakuDateTime(row.createdAt)}</time></td>
        <td className="px-4 py-3.5">{row.actorEmail || "Sistem"}</td>
        <td className="px-4 py-3.5">{row.action}</td>
        <td className="px-4 py-3.5">{`${row.entityType} · ${row.entityId || "—"}`}</td>
        <td className="px-4 py-3.5"><pre className="max-w-xs whitespace-pre-wrap text-xs">{JSON.stringify(row.metadata || {})}</pre></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export default async function AdminAuditLogPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  const sp = normalizeAdminSearchParams(await searchParams);
  const { filters, errors } = parseAuditLogFilters(sp);
  const page = normalizeAdminPage(sp.page);
  const query = auditFiltersToSearchParams(filters).toString();
  const filtered = query.length > 0;

  const [result, distinct] = await Promise.all([
    findAuditLogPage(prisma, filters, { skip: (page - 1) * AUDIT_LOG_PAGE_SIZE, take: AUDIT_LOG_PAGE_SIZE }).catch(() => null),
    auditDistinctValues(prisma).catch(() => ({ actions: [], entityTypes: [] })),
  ]);

  return <AdminShell email={admin.email}>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">BAGATI · ADMIN</p>
        <h1 className="mt-2 text-3xl font-semibold text-[#0d1b2a]">Audit jurnalı</h1>
        <p className="mt-2 text-sm text-slate-500">Yalnız sistemdə yazılmış audit qeydləri göstərilir. Tarixlər Bakı vaxtı ilə filtrlənir.</p>
      </div>
      <AdminAuditExportButton filters={Object.fromEntries(auditFiltersToSearchParams(filters))} maxRows={AUDIT_EXPORT_MAX_ROWS} />
    </div>

    <form action="/admin/audit-log" className="mb-4 grid gap-3 rounded-2xl border border-[#e7e3d9] bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
      <label className={label}>İcraçı<input name="actor" defaultValue={actorInputValue(filters)} placeholder="E-poçt, ID və ya system" className={input} /></label>
      <Select name="action" title="Əməl" values={distinct.actions} selected={filters.action} />
      <Select name="entityType" title="Obyekt növü" values={distinct.entityTypes} selected={filters.entityType} />
      <label className={label}>Obyekt ID-si<input name="entityId" defaultValue={filters.entityId ?? ""} className={input} /></label>
      <label className={label}>Başlanğıc tarixi<input type="date" name="from" defaultValue={filters.from ?? ""} className={input} /></label>
      <label className={label}>Son tarix<input type="date" name="to" defaultValue={filters.to ?? ""} className={input} /></label>
      <label className={label}>Mətn (obyekt ID-si, əlavə məlumat)<input name="q" defaultValue={filters.q ?? ""} maxLength={100} placeholder="Axtar…" className={input} /></label>
      <div className="flex items-end gap-2">
        <button className="rounded-lg bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white">Filtrlə</button>
        {filtered && <Link href="/admin/audit-log" className="rounded-lg border px-4 py-2.5 text-sm">Sıfırla</Link>}
      </div>
    </form>

    {errors.length > 0 && <div role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">Bəzi filtrlər nəzərə alınmadı:</p>
      <ul className="mt-1 list-disc pl-5">{errors.map((error) => <li key={error}>{error}</li>)}</ul>
    </div>}

    {result
      ? <><AuditTable rows={result.rows} /><Pager page={page} total={result.total} query={query} /></>
      : <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Audit qeydləri yüklənmədi (sorğu vaxtı bitdi və ya baza əlçatan deyil). Filtrləri daraldıb yenidən cəhd edin.</div>}
  </AdminShell>;
}
