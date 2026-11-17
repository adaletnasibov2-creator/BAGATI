import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { createSmtpTransport, sendDiagnosticEmail } from "@/lib/email";
import { handleAdminTestEmail } from "@/lib/admin-email-actions";
import { adminEmailActionDependencies } from "@/lib/admin-email-action-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** "Test e-poçtu göndər": one diagnostic email to the signed-in admin's own address. No recipient is accepted. */
export async function POST(request: NextRequest) {
  return handleAdminTestEmail(request, {
    ...adminEmailActionDependencies,
    requireAdmin: async () => {
      const admin = await requireRole("ADMIN");
      return admin ? { id: admin.id, email: admin.email } : null;
    },
    sendDiagnostic: (to) => sendDiagnosticEmail(to, (config) => createSmtpTransport(config, 15_000)),
  });
}
