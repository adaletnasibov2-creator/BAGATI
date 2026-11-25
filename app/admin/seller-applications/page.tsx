import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeAdminEnumFilter, normalizeAdminPage, normalizeAdminSearch, normalizeAdminSearchParams, type AdminSearchParams } from "@/lib/admin-pagination";
import { formatBakuDateTime } from "@/lib/admin-audit-log";
import StatusBadge from "@/components/seller-application-status-badge";
import { EmptyState } from "@/components/admin-ui/empty-state";
import { AdminListToolbar } from "@/components/admin-list-toolbar";
import { PageHeader } from "@/components/admin-ui/page-header";
import { buttonClass, focusRing, inputClass } from "@/components/admin-ui/styles";
import { maskVoen, SELLER_APPLICATION_SOURCE_LABELS, SELLER_APPLICATION_STATUS_LABELS, SELLER_TYPE_LABELS } from "@/lib/seller-application";
import { listSellerApplications, SELLER_APPLICATION_PAGE_SIZE, type SellerApplicationListFilters } from "@/lib/seller-application-service";

export const dynamic = "force-dynamic";

// ADMIN-DESIGN-1: the admin kit (seller-panel tokens) for header, filters, table, empty state and pager. Same text.
const input = inputClass;
const label = "grid min-w-0 gap-1.5 text-xs font-medium text-fg-secondary";
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

  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}>
    <PageHeader title="Satıcı müraciətləri" description="Müştəri hesabı yalnız burada təsdiqləndikdən sonra satıcı hesabına çevrilir. VÖEN siyahıda qismən göstərilir; tam məlumat müraciət səhifəsindədir." />
    <AdminListToolbar path="/admin/seller-applications" sp={sp} options={STATUS_FILTERS.filter((status) => status !== "ALL").map((status) => ({ id: status, name: SELLER_APPLICATION_STATUS_LABELS[status] }))} selected={filters.status} allValue="ALL" exportList="seller-applications" />

    <form action="/admin/seller-applications" className="mb-4 grid gap-3 rounded-card border border-line bg-white p-4 shadow-subtle sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
      <label className={label}>Status<select name="status" defaultValue={filters.status} className={input}>
        {STATUS_FILTERS.map((status) => <option key={status} value={status}>{status === "ALL" ? "Hamısı" : SELLER_APPLICATION_STATUS_LABELS[status]}</option>)}
      </select></label>
      <label className={label}>Axtarış (ad, hüquqi ad, VÖEN, e-poçt)<input name="q" defaultValue={filters.q} maxLength={100} placeholder="Axtar…" className={input} /></label>
      <div className="flex items-end gap-2">
        <button className={buttonClass("primary", "min-h-11")}>Filtrlə</button>
        {(filters.q || filters.status !== "PENDING") && <Link href="/admin/seller-applications" className={buttonClass("secondary", "min-h-11")}>Sıfırla</Link>}
      </div>
    </form>

    {!result
      ? <div role="alert" className="rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-800">Müraciətlər yüklənmədi. Bir az sonra yenidən cəhd edin.</div>
      : !result.rows.length
        ? <EmptyState title="Bu filtrlə müraciət yoxdur." />
        : <>
          <ul className="grid gap-3 lg:hidden">{result.rows.map((row) => <li key={row.id}>
            <Link href={`/admin/seller-applications/${row.id}`} className={`block rounded-card border border-line bg-white p-4 shadow-subtle transition-colors hover:border-brand-200 ${focusRing}`}>
              <div className="flex items-start justify-between gap-3"><p className="min-w-0 break-words font-semibold text-fg">{row.displayName}</p><StatusBadge status={row.status} /></div>
              <p className="mt-1 break-all text-sm text-fg-secondary">{row.user.email}</p>
              <p className="mt-2 text-xs text-fg-secondary">{formatBakuDateTime(row.createdAt)} · VÖEN {maskVoen(row.voenNormalized)}</p>
              {row.duplicateVoen && <p className="mt-2 text-xs font-medium text-amber-800">VÖEN başqa yerdə də var</p>}
            </Link>
          </li>)}</ul>
          <div className="hidden overflow-x-auto rounded-card border border-line bg-white shadow-subtle lg:block">
            <table className="w-full min-w-[760px] text-left text-sm text-fg-body">
              <thead className="border-b border-line bg-surface-page text-xs uppercase tracking-wide text-fg-secondary">
                <tr>{["Müraciətçi", "Satıcı adı", "Növ", "VÖEN", "Mənbə", "Status", "Göndərilib (Bakı)"].map((title) => <th key={title} className="whitespace-nowrap px-4 py-3 font-semibold">{title}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">{result.rows.map((row) => <tr key={row.id} className="align-top transition-colors hover:bg-surface-page motion-reduce:transition-none">
                <td className="px-4 py-3.5"><Link className={`rounded font-semibold text-primary underline-offset-2 hover:underline ${focusRing}`} href={`/admin/seller-applications/${row.id}`}>{row.user.email}</Link></td>
                <td className="px-4 py-3.5">{row.displayName}</td>
                <td className="px-4 py-3.5">{row.sellerType ? SELLER_TYPE_LABELS[row.sellerType] : "—"}</td>
                <td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs">{maskVoen(row.voenNormalized)}{row.duplicateVoen && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 font-sans text-[11px] font-medium text-amber-800" title="Bu VÖEN başqa satıcıda və ya açıq müraciətdə var">təkrar</span>}</td>
                <td className="px-4 py-3.5 text-xs text-fg-secondary">{SELLER_APPLICATION_SOURCE_LABELS[row.source]}</td>
                <td className="px-4 py-3.5"><StatusBadge status={row.status} /></td>
                <td className="whitespace-nowrap px-4 py-3.5">{formatBakuDateTime(row.createdAt)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-fg-secondary">Səhifə {Math.min(page, pages)} / {pages} · {result.total} müraciət</span>
            <div className="flex gap-2">
              {page > 1 && <Link className={buttonClass("secondary")} href={`/admin/seller-applications?${query}&page=${Math.min(page - 1, pages)}`}>Əvvəlki</Link>}
              {page < pages && <Link className={buttonClass("secondary")} href={`/admin/seller-applications?${query}&page=${page + 1}`}>Növbəti</Link>}
            </div>
          </div>
        </>}
  </AdminShell>;
}
