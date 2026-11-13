import Link from "next/link";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import AdminSessionsList from "@/components/admin-sessions-list";
import { currentSessionId, requireRole } from "@/lib/auth";
import { listActiveSessions } from "@/lib/admin-sessions";
import { formatBakuDateTime } from "@/lib/admin-audit-log";

export const dynamic = "force-dynamic";

export default async function AdminSessionsPage() {
  const admin = await requireRole("ADMIN");
  if (!admin) redirect("/admin/login");
  const sessions = await listActiveSessions(admin.id, await currentSessionId());
  const rows = sessions.map((session) => ({
    id: session.id,
    createdLabel: formatBakuDateTime(session.createdAt),
    lastSeenLabel: session.lastSeenAt ? formatBakuDateTime(session.lastSeenAt) : "—",
    expiresLabel: formatBakuDateTime(session.expiresAt),
    ipMasked: session.ipMasked,
    userAgent: session.userAgent,
    current: session.current,
  }));
  return <AdminShell email={admin.email}>
    <div className="mb-6">
      <Link href="/admin/security" className="text-sm font-medium text-[#85621d]">← Hesab təhlükəsizliyi</Link>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">BAGATI · ADMIN</p>
      <h1 className="mt-2 text-3xl font-semibold text-[#0d1b2a]">Aktiv sessiyalar</h1>
      <p className="mt-2 text-sm text-slate-500">Hesabınızın açıq olduğu cihazlar. Tanımadığınız sessiyanı dərhal bağlayın və şifrənizi dəyişin.</p>
    </div>
    <AdminSessionsList sessions={rows} />
  </AdminShell>;
}
