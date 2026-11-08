import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import AdminSecurityCenter from "@/components/admin-security-center";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminSecurityCenterPage() {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  return <AdminShell email={admin.email}><AdminSecurityCenter /></AdminShell>;
}
