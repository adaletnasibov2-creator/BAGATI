import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { DataTable } from "@/components/admin-ui/data-table";
import { buttonClass, focusRing } from "@/components/admin-ui/styles";
import { requireRole } from "@/lib/auth";
import { normalizeAdminPage, normalizeAdminSearchParams } from "@/lib/admin-pagination";
import { formatMessageTime } from "@/lib/messaging-client";
import { isReportStatus, listConversationReports, REPORT_STATUS_LABELS, REPORT_STATUSES } from "@/lib/messaging-admin";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;
const contextLabels = { PRODUCT: "Məhsul", ORDER: "Sifariş", STORE: "Ümumi" } as const;
const statusTone = { OPEN: "bg-amber-50 text-amber-900", REVIEWED: "bg-emerald-50 text-emerald-900", DISMISSED: "bg-surface-sunken text-fg-body" } as const;

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
      <h1 className="text-h1 text-fg">Mesaj şikayətləri</h1>
      <p className="mt-1 max-w-3xl text-sm text-fg-secondary">Müştəri və mağaza söhbətlərinə gələn şikayətlər. Mesaj mətni yalnız şikayət açıldıqda göstərilir və hər açılış audit jurnalına yazılır. Şikayət olunmayan söhbətlərə giriş yoxdur.</p>
    </header>
    <nav aria-label="Status" className="mb-4 flex flex-wrap gap-2">
      {[...REPORT_STATUSES, "all" as const].map((value) => {
        const active = (status ?? "all") === value;
        return <Link key={value} href={href({ status: value, page: 1 })} aria-current={active ? "page" : undefined} className={`rounded-full px-4 py-2 text-sm font-medium ${active ? "bg-primary text-white" : "border border-line-strong bg-white text-fg-body"}`}>{value === "all" ? "Hamısı" : REPORT_STATUS_LABELS[value]}</Link>;
      })}
    </nav>
    {/* ADMIN-DESIGN-2: the kit's DataTable (cards under 768 px, no sideways page scroll); same columns and texts. */}
    <p className="mb-3 text-sm text-fg-secondary">{total} şikayət</p>
    <DataTable rows={items} rowKey={(item) => item.id} empty="Şikayət yoxdur." caption="Mesaj şikayətləri" columns={[
      { label: "Tarix", cell: (item) => <span className="whitespace-nowrap text-fg-secondary">{formatMessageTime(item.createdAt)}</span> },
      { label: "Mağaza", cell: (item) => <Link href={`/admin/stores/${encodeURIComponent(item.store.id)}`} className={`rounded font-medium text-primary hover:underline ${focusRing}`}>{item.store.name}</Link> },
      { label: "Müştəri", cell: (item) => item.customerDeleted ? <span className="text-fg-secondary">{item.customer}</span> : item.customer },
      { label: "Şikayət edən", cell: (item) => item.reporterRole === "STORE" ? "Mağaza" : "Müştəri" },
      { label: "Səbəb", cell: (item) => item.reasonLabel },
      { label: "Mövzu", cell: (item) => contextLabels[item.context] },
      { label: "Status", cell: (item) => <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone[item.status]}`}>{REPORT_STATUS_LABELS[item.status]}</span> },
      // prefetch off: opening is audited, so only a real click may render the conversation.
      { label: "Aç", numeric: true, cell: (item) => <Link prefetch={false} href={`/admin/messages/reports/${encodeURIComponent(item.id)}`} className={buttonClass("primary", "min-h-9 px-3 py-2 text-xs")}>Aç</Link> },
    ]} />
    {pages > 1 && <nav aria-label="Səhifələr" className="mt-4 flex items-center justify-between text-sm">
      {page > 1 ? <Link href={href({ page: page - 1 })} className={buttonClass("secondary")}>← Əvvəlki</Link> : <span/>}
      <span className="text-fg-secondary">{page} / {pages}</span>
      {page < pages ? <Link href={href({ page: page + 1 })} className={buttonClass("secondary")}>Növbəti →</Link> : <span/>}
    </nav>}
  </AdminShell>;
}
