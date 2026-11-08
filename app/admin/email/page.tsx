import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import AdminEmailOperations from "@/components/admin-email-operations";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminEmailPage() {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  return <AdminShell email={admin.email}><AdminEmailOperations /></AdminShell>;
}
