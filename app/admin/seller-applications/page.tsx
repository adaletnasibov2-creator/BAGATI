import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeAdminEnumFilter, normalizeAdminPage, normalizeAdminSearch, normalizeAdminSearchParams, type AdminSearchParams } from "@/lib/admin-pagination";
import { formatBakuDateTime } from "@/lib/admin-audit-log";
import StatusBadge from "@/components/seller-application-status-badge";
import { maskVoen, SELLER_APPLICATION_SOURCE_LABELS, SELLER_APPLICATION_STATUS_LABELS, SELLER_TYPE_LABELS } from "@/lib/seller-application";
import { listSellerApplications, SELLER_APPLICATION_PAGE_SIZE, type SellerApplicationListFilters } from "@/lib/seller-application-service";

export const dynamic = "force-dynamic";

const input = "rounded-lg border border-[#ded9cf] bg-white px-3 py-2.5 text-sm text-slate-800";
const label = "grid min-w-0 gap-1 text-xs text-slate-500";
const STATUS_FILTERS = ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN", "ALL"] as const;
export default async function AdminSellerApplicationsPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  const sp = normalizeAdminSearchParams(await searchParams);
  const filters: SellerApplicationListFilters = {
    status: normalizeAdminEnumFilter(sp.status, STATUS_FILTERS) ?? "PENDING",
    q: normalizeAdminSearch(sp.q).slice(0, 100),
  };
  const page = normalizeAdminPage(sp.page);
  const result = await listSellerApplications(prisma, filters, page).catch(() => null);
  const query = new URLSearchParams({ status: filters.status, ...(filters.q ? { q: filters.q } : {}) }).toString();
  const pages = result ? Math.max(1, Math.ceil(result.total / SELLER_APPLICATION_PAGE_SIZE)) : 1;

  return <AdminShell email={admin.email}>
    <div className="mb-6">
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">BAGATI · ADMIN</p>
      <h1 className="mt-2 text-3xl font-semibold text-[#0d1b2a]">Satıcı müraciətləri</h1>
      <p className="mt-2 text-sm text-slate-500">Müştəri hesabı yalnız burada təsdiqləndikdən sonra satıcı hesabına çevrilir. VÖEN siyahıda qismən göstərilir; tam məlumat müraciət səhifəsindədir.</p>
    </div>

    <form action="/admin/seller-applications" className="mb-4 grid gap-3 rounded-2xl border border-[#e7e3d9] bg-white p-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
      <label className={label}>Status<select name="status" defaultValue={filters.status} className={input}>
        {STATUS_FILTERS.map((status) => <option key={status} value={status}>{status === "ALL" ? "Hamısı" : SELLER_APPLICATION_STATUS_LABELS[status]}</option>)}
      </select></label>
      <label className={label}>Axtarış (ad, hüquqi ad, VÖEN, e-poçt)<input name="q" defaultValue={filters.q} maxLength={100} placeholder="Axtar…" className={input} /></label>
      <div className="flex items-end gap-2">
        <button className="rounded-lg bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white">Filtrlə</button>
        {(filters.q || filters.status !== "PENDING") && <Link href="/admin/seller-applications" className="rounded-lg border px-4 py-2.5 text-sm">Sıfırla</Link>}
      </div>
    </form>

    {!result
      ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">Müraciətlər yüklənmədi. Bir az sonra yenidən cəhd edin.</div>
      : !result.rows.length
        ? <div className="rounded-2xl border border-[#e7e3d9] bg-white p-5 text-sm text-slate-500">Bu filtrlə müraciət yoxdur.</div>
        : <>
          <ul className="grid gap-3 lg:hidden">{result.rows.map((row) => <li key={row.id}>
            <Link href={`/admin/seller-applications/${row.id}`} className="block rounded-2xl border border-[#e7e3d9] bg-white p-4">
              <div className="flex items-start justify-between gap-3"><p className="min-w-0 break-words font-medium text-[#0d1b2a]">{row.displayName}</p><StatusBadge status={row.status} /></div>
              <p className="mt-1 break-all text-sm text-slate-600">{row.user.email}</p>
              <p className="mt-2 text-xs text-slate-500">{formatBakuDateTime(row.createdAt)} · VÖEN {maskVoen(row.voenNormalized)}</p>
              {row.duplicateVoen && <p className="mt-2 text-xs font-medium text-amber-800">VÖEN başqa yerdə də var</p>}
            </Link>
          </li>)}</ul>
          <div className="hidden overflow-x-auto rounded-2xl border border-[#e7e3d9] bg-white lg:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-[#f8f7f4] text-xs uppercase tracking-wide text-slate-500">
                <tr>{["Göndərilib (Bakı)", "Müraciətçi", "Satıcı adı", "Növ", "VÖEN", "Status", "Mənbə"].map((title) => <th key={title} className="px-4 py-3 font-medium">{title}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-[#eeeae2]">{result.rows.map((row) => <tr key={row.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-3.5">{formatBakuDateTime(row.createdAt)}</td>
                <td className="px-4 py-3.5"><Link className="font-medium text-[#173c40] underline-offset-2 hover:underline" href={`/admin/seller-applications/${row.id}`}>{row.user.email}</Link></td>
                <td className="px-4 py-3.5">{row.displayName}</td>
                <td className="px-4 py-3.5">{row.sellerType ? SELLER_TYPE_LABELS[row.sellerType] : "—"}</td>
                <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs">{maskVoen(row.voenNormalized)}{row.duplicateVoen && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 font-sans text-[11px] font-medium text-amber-800" title="Bu VÖEN başqa satıcıda və ya açıq müraciətdə var">təkrar</span>}</td>
                <td className="px-4 py-3.5"><StatusBadge status={row.status} /></td>
                <td className="px-4 py-3.5 text-xs text-slate-500">{SELLER_APPLICATION_SOURCE_LABELS[row.source]}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-slate-500">Səhifə {Math.min(page, pages)} / {pages} · {result.total} müraciət</span>
            <div className="flex gap-2">
              {page > 1 && <Link className="rounded-lg border bg-white px-3 py-2" href={`/admin/seller-applications?${query}&page=${Math.min(page - 1, pages)}`}>Əvvəlki</Link>}
              {page < pages && <Link className="rounded-lg border bg-white px-3 py-2" href={`/admin/seller-applications?${query}&page=${page + 1}`}>Növbəti</Link>}
            </div>
          </div>
        </>}
  </AdminShell>;
}
