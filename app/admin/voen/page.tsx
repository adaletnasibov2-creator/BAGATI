import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { AdminVoenBulk } from "@/components/admin-voen-bulk";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeAdminEnumFilter, normalizeAdminPage, normalizeAdminSearch, normalizeAdminSearchParams, type AdminSearchParams } from "@/lib/admin-pagination";
import { parseVoen, voenKindLabel } from "@/lib/voen";
import { listSellersForVoenReview, VOEN_LIST_PAGE_SIZE } from "@/lib/voen-verification";

export const dynamic = "force-dynamic";

const FILTERS = ["UNVERIFIED", "VERIFIED", "ALL"] as const;
const FILTER_LABELS = { UNVERIFIED: "Yoxlanmayıb", VERIFIED: "Təsdiqlənib", ALL: "Hamısı" } as const;
const input = "rounded-lg border border-[#ded9cf] bg-white px-3 py-2.5 text-sm text-slate-800";

/** VÖEN yoxlaması: every seller's VÖEN status; bulk verify after checking each number on the official search. */
export default async function AdminVoenPage({ searchParams }: { searchParams: Promise<AdminSearchParams> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  const sp = normalizeAdminSearchParams(await searchParams);
  const filter = normalizeAdminEnumFilter(sp.status, FILTERS) ?? "UNVERIFIED";
  const q = normalizeAdminSearch(sp.q).slice(0, 100);
  const page = normalizeAdminPage(sp.page);
  const result = await listSellersForVoenReview(prisma, { filter, q, page }).catch(() => null);
  const pages = result ? Math.max(1, Math.ceil(result.total / VOEN_LIST_PAGE_SIZE)) : 1;
  const query = (p: number) => `/admin/voen?${new URLSearchParams({ status: filter, ...(q ? { q } : {}), page: String(p) })}`;
  const rows = (result?.rows ?? []).map((row) => {
    const parsed = parseVoen(row.digits);
    return {
      userId: row.userId, displayName: row.displayName, email: row.email, digits: row.digits, formatValid: parsed.ok,
      kindLabel: parsed.ok ? voenKindLabel(parsed.kind) : null, verified: row.verified, duplicate: row.duplicate,
      stores: row.stores, storeNames: row.storeNames, storeHref: row.firstStoreId ? `/admin/stores/${row.firstStoreId}` : null,
    };
  });

  return <AdminShell email={admin.email}>
    <div className="mb-6">
      <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">BAGATI · ADMIN</p>
      <h1 className="mt-2 text-3xl font-semibold text-[#0d1b2a]">VÖEN yoxlaması</h1>
      <p className="mt-2 max-w-3xl text-sm text-slate-500">Mağaza səhifəsində “Təsdiqlənmiş satıcı” nişanı yalnız VÖEN admin tərəfindən təsdiqlənəndə görünür. Hər VÖEN-i rəsmi vergi axtarışında yoxlayın (“e-taxes-də yoxla”, VÖEN-i yapışdırın), uyğun olanları seçin və bir qeydlə təsdiqləyin. Hər təsdiq audit jurnalına yazılır.</p>
    </div>
    <form action="/admin/voen" className="mb-4 grid gap-3 rounded-2xl border border-[#e7e3d9] bg-white p-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
      <label className="grid min-w-0 gap-1 text-xs text-slate-500">Status<select name="status" defaultValue={filter} className={input}>
        {FILTERS.map((value) => <option key={value} value={value}>{FILTER_LABELS[value]}</option>)}
      </select></label>
      <label className="grid min-w-0 gap-1 text-xs text-slate-500">Axtarış<input name="q" defaultValue={q} placeholder="Ad, e-poçt və ya VÖEN" className={input} /></label>
      <button className="self-end rounded-lg bg-[#173c40] px-4 py-2.5 text-sm font-semibold text-white">Göstər</button>
    </form>
    {!result && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">Siyahını yükləmək alınmadı.</p>}
    {result && <p className="mb-3 text-sm text-slate-500">{result.total} satıcı · səhifə {page} / {pages}</p>}
    <AdminVoenBulk rows={rows} />
    {pages > 1 && <nav aria-label="Səhifələr" className="mt-4 flex gap-2 text-sm">
      {page > 1 && <Link href={query(page - 1)} className="rounded-lg border px-3 py-2">← Əvvəlki</Link>}
      {page < pages && <Link href={query(page + 1)} className="rounded-lg border px-3 py-2">Növbəti →</Link>}
    </nav>}
  </AdminShell>;
}
