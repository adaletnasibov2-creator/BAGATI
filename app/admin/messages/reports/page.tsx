import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { requireRole } from "@/lib/auth";
import { normalizeAdminPage, normalizeAdminSearchParams } from "@/lib/admin-pagination";
import { formatMessageTime } from "@/lib/messaging-client";
import { isReportStatus, listConversationReports, REPORT_STATUS_LABELS, REPORT_STATUSES } from "@/lib/messaging-admin";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;
const card = "rounded-2xl border border-[#e7e3d9] bg-white p-5";
const contextLabels = { PRODUCT: "Məhsul", ORDER: "Sifariş", STORE: "Ümumi" } as const;
const statusTone = { OPEN: "bg-amber-50 text-amber-900", REVIEWED: "bg-emerald-50 text-emerald-900", DISMISSED: "bg-slate-100 text-slate-700" } as const;

/**
 * Messaging reports (phase 8). The list never shows message text: store, customer display name, reason, date and
 * status only. Opening a report (the only way to read a conversation) is audited.
 */
export default async function AdminMessageReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  const sp = normalizeAdminSearchParams(await searchParams);
  // Default: the open reports. "all" lists every status.
  const status = sp.status === "all" ? null : isReportStatus(sp.status) ? sp.status : "OPEN";
  const page = normalizeAdminPage(sp.page);
  const { items, total } = await listConversationReports(prisma, { status, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (next: { status?: string | null; page?: number }) => {
    const params = new URLSearchParams();
    const s = next.status === undefined ? (status ?? "all") : (next.status ?? "all");
    if (s !== "OPEN") params.set("status", s);
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const query = params.toString();
    return `/admin/messages/reports${query ? `?${query}` : ""}`;
  };
  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}>
    <header className="mb-5">
      <h1 className="text-2xl font-semibold text-[#142d38]">Mesaj şikayətləri</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-600">Müştəri və mağaza söhbətlərinə gələn şikayətlər. Mesaj mətni yalnız şikayət açıldıqda göstərilir və hər açılış audit jurnalına yazılır. Şikayət olunmayan söhbətlərə giriş yoxdur.</p>
    </header>
    <nav aria-label="Status" className="mb-4 flex flex-wrap gap-2">
      {[...REPORT_STATUSES, "all" as const].map((value) => {
        const active = (status ?? "all") === value;
        return <Link key={value} href={href({ status: value, page: 1 })} aria-current={active ? "page" : undefined} className={`rounded-full px-4 py-2 text-sm font-medium ${active ? "bg-[#142d38] text-white" : "border border-[#ded9cf] bg-white text-slate-700"}`}>{value === "all" ? "Hamısı" : REPORT_STATUS_LABELS[value]}</Link>;
      })}
    </nav>
    <section className={card}>
      <p className="mb-3 text-sm text-slate-500">{total} şikayət</p>
      {items.length === 0
        ? <p className="py-8 text-center text-sm text-slate-500">Şikayət yoxdur.</p>
        : <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500"><tr>
              <th className="py-2 pr-3 font-medium">Tarix</th><th className="py-2 pr-3 font-medium">Mağaza</th><th className="py-2 pr-3 font-medium">Müştəri</th>
              <th className="py-2 pr-3 font-medium">Şikayət edən</th><th className="py-2 pr-3 font-medium">Səbəb</th><th className="py-2 pr-3 font-medium">Mövzu</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium"><span className="sr-only">Aç</span></th>
            </tr></thead>
            <tbody className="divide-y divide-[#eee9df]">
              {items.map((item) => <tr key={item.id}>
                <td className="py-3 pr-3 whitespace-nowrap text-slate-600">{formatMessageTime(item.createdAt)}</td>
                <td className="py-3 pr-3"><Link href={`/admin/stores/${encodeURIComponent(item.store.id)}`} className="font-medium text-[#173c40]">{item.store.name}</Link></td>
                <td className="py-3 pr-3">{item.customerDeleted ? <span className="text-slate-500">{item.customer}</span> : item.customer}</td>
                <td className="py-3 pr-3">{item.reporterRole === "STORE" ? "Mağaza" : "Müştəri"}</td>
                <td className="py-3 pr-3">{item.reasonLabel}</td>
                <td className="py-3 pr-3">{contextLabels[item.context]}</td>
                <td className="py-3 pr-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone[item.status]}`}>{REPORT_STATUS_LABELS[item.status]}</span></td>
                {/* prefetch off: opening is audited, so only a real click may render the conversation. */}
                <td className="py-3 text-right"><Link prefetch={false} href={`/admin/messages/reports/${encodeURIComponent(item.id)}`} className="rounded-lg bg-[#173c40] px-3 py-2 text-xs font-semibold text-white">Aç</Link></td>
              </tr>)}
            </tbody>
          </table>
        </div>}
      {pages > 1 && <nav aria-label="Səhifələr" className="mt-4 flex items-center justify-between text-sm">
        {page > 1 ? <Link href={href({ page: page - 1 })} className="text-[#173c40]">← Əvvəlki</Link> : <span/>}
        <span className="text-slate-500">{page} / {pages}</span>
        {page < pages ? <Link href={href({ page: page + 1 })} className="text-[#173c40]">Növbəti →</Link> : <span/>}
      </nav>}
    </section>
  </AdminShell>;
}
