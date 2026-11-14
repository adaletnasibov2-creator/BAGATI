import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import AdminSecurityMonitoring from "@/components/admin-security-monitoring";
import { requireRole } from "@/lib/auth";
import { requireSecurityPermission } from "@/lib/security-monitoring/permissions";

export const dynamic = "force-dynamic";

/** Security Center: live monitoring, events, incidents, alert rules and sources (tabs; ?tab=live|events|incidents|rules|sources). */
export default async function AdminSecurityCenterPage() {
  const admin = await requireRole("ADMIN");
  if (!admin || !requireSecurityPermission(admin, "security.view")) redirect("/admin/login");
  return <AdminShell email={admin.email}><AdminSecurityMonitoring /></AdminShell>;
}
