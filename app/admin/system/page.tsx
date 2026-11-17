import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { adminMessagingNavEnabled } from "@/lib/messaging-pages";
import AdminSystemStatus from "@/components/admin-system-status";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminSystemStatusPage() {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  return <AdminShell email={admin.email} messagingEnabled={await adminMessagingNavEnabled()}><AdminSystemStatus /></AdminShell>;
}
