import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import AdminSecurityMonitoring from "@/components/admin-security-monitoring";
import { requireRole } from "@/lib/auth";
import { requireSecurityPermission } from "@/lib/security-monitoring/permissions";

export const dynamic = "force-dynamic";

/** Incidents (status, assignee, notes) and alert rules (?tab=incidents|rules); reached from the security summary. */
export default async function AdminSecurityIncidentsPage() {
  const admin = await requireRole("ADMIN");
  if (!admin || !requireSecurityPermission(admin, "security.view")) redirect("/admin/login");
  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}><AdminSecurityMonitoring /></AdminShell>;
}
