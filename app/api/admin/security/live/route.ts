import { prisma } from "@/lib/prisma";
import { readLiveSnapshot } from "@/lib/security-monitoring/admin";
import { authorizeSecurityAdmin, securityErrorResponse, securityJson } from "@/lib/security-monitoring/http";
import { securityTelemetry } from "@/lib/security-monitoring/instance";
import { maybeRunMonitoringJobs } from "@/lib/security-monitoring/jobs";
import { TELEMETRY_FLUSH_INTERVAL_MS } from "@/lib/security-monitoring/telemetry";

export const dynamic = "force-dynamic";

/**
 * Live panel data (polled every 15 s). Flushes this process's pending counters first (waits at most 1 s) and starts
 * the throttled monitoring jobs in the background, so rules are evaluated even when no other traffic flushes.
 */
export async function GET(request: Request) {
  const auth = await authorizeSecurityAdmin(request, "security.view", { write: false });
  if ("response" in auth) return auth.response;
  await Promise.race([securityTelemetry.flush(), new Promise((resolve) => setTimeout(resolve, 1_000))]);
  void maybeRunMonitoringJobs();
  try {
    const snapshot = await readLiveSnapshot(prisma);
    const lastFlushAt = securityTelemetry.lastFlushAt();
    return securityJson({
      ...snapshot,
      telemetry: {
        flushIntervalSeconds: TELEMETRY_FLUSH_INTERVAL_MS / 1000,
        processLastFlushAt: lastFlushAt ? new Date(lastFlushAt).toISOString() : null,
      },
    });
  } catch (error) {
    return securityErrorResponse("admin_security_live_read", error);
  }
}
