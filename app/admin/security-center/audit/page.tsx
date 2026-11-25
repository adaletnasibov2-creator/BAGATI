import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { Block, date, empty, linkClass, RowTable, SecurityCenterHeader, unavailable } from "@/components/security-center-ui";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import { requireRole } from "@/lib/auth";
import { requireSecurityPermission } from "@/lib/security-monitoring/permissions";
import { auditActionLabel } from "@/lib/audit-action-labels";
import { AUDIT_MAX_PAGES, AUDIT_PAGE_SIZE, loadSecurityAudit } from "@/lib/security-center-data";

export const dynamic = "force-dynamic";

/**
 * "Audit" tab (SECURITY-CENTER-DESIGN-2): the security actions from the audit log ("Son təhlükəsizlik əməliyyatları",
 * moved from the overview), 10 per page, with the existing labels. No IPs on this tab. The full log stays at
 * /admin/audit-log.
 */
export default async function AdminSecurityAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireRole("ADMIN");
  if (!admin || !requireSecurityPermission(admin, "security.view")) redirect("/admin/login");
  const params = await searchParams;
  const requested = Number(Array.isArray(params.page) ? params.page[0] : params.page ?? "1");
  const now = new Date();
  const audit = await loadSecurityAudit(Number.isSafeInteger(requested) ? requested : 1);
  const pages = audit ? Math.min(AUDIT_MAX_PAGES, Math.max(1, Math.ceil(audit.total / AUDIT_PAGE_SIZE))) : 1;
  const href = (page: number) => `/admin/security-center/audit?page=${page}`;

  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}>
    <SecurityCenterHeader active="audit" renderedAt={now.toISOString()}/>
    <Block title="Son təhlükəsizlik əməliyyatları">
      {!audit ? unavailable : !audit.rows.length ? empty("Qeyd yoxdur.") : <RowTable head={["Nə vaxt", "Kim", "Əməl"]}
        rows={audit.rows.map((row) => ({ key: row.id, cells: [<span key="d" className="whitespace-nowrap">{date(row.createdAt)}</span>, row.actor?.email ?? "Sistem", auditActionLabel(row.action)] }))}/>}
      {audit && pages > 1 && <nav aria-label="Səhifələr" className="mt-4 flex items-center justify-between gap-2 text-sm">
        {audit.page > 1 ? <Link href={href(audit.page - 1)} prefetch={false} className="inline-flex min-h-11 items-center rounded-control border border-line px-4">Əvvəlki</Link> : <span />}
        <span className="text-fg-secondary">{audit.page} / {pages}</span>
        {audit.page < pages ? <Link href={href(audit.page + 1)} prefetch={false} className="inline-flex min-h-11 items-center rounded-control border border-line px-4">Növbəti</Link> : <span />}
      </nav>}
      <Link href="/admin/audit-log" className={`mt-3 inline-block ${linkClass}`}>Audit jurnalı →</Link>
    </Block>
  </AdminShell>;
}
