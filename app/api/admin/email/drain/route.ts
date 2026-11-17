import { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { handleAdminOutboxDrain } from "@/lib/admin-email-actions";
import { adminEmailActionDependencies } from "@/lib/admin-email-action-runtime";
import { drainEmailOutboxNow } from "@/lib/email-worker-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** "Növbəni indi göndər": one outbox batch now, under the same advisory lock as the in-process worker. */
export async function POST(request: NextRequest) {
  return handleAdminOutboxDrain(request, {
    ...adminEmailActionDependencies,
    requireAdmin: async () => {
      const admin = await requireRole("ADMIN");
      return admin ? { id: admin.id, email: admin.email } : null;
    },
    drain: () => drainEmailOutboxNow(),
  });
}
