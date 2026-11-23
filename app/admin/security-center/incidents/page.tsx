import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import AdminSecurityMonitoring from "@/components/admin-security-monitoring";
import { SecurityCenterHeader } from "@/components/security-center-ui";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import { requireRole } from "@/lib/auth";
import { requireSecurityPermission } from "@/lib/security-monitoring/permissions";

export const dynamic = "force-dynamic";

/** "İnsidentlər" tab: incidents (status, assignee, notes) and alert rules (?tab=incidents|rules). */
export default async function AdminSecurityIncidentsPage() {
  const admin = await requireRole("ADMIN");
  if (!admin || !requireSecurityPermission(admin, "security.view")) redirect("/admin/login");
  const renderedAt = new Date().toISOString();
  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}>
    <SecurityCenterHeader active="incidents" renderedAt={renderedAt}/>
    {/* refreshedAt: "Yenilə" re-renders this page; the client list then loads again with its filters kept. */}
    <AdminSecurityMonitoring refreshedAt={renderedAt} />
  </AdminShell>;
}
