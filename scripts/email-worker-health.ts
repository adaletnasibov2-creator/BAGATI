import { loadEnvFile } from "node:process";
import { evaluateEmailWorkerMonitoring, readEmailWorkerHeartbeat } from "@/lib/email-worker-monitoring";
import { safeWorkerFailureCode } from "@/lib/email-outbox-core";

try { loadEnvFile(".env"); } catch { /* Production environments provide variables directly. */ }

async function main() {
  const [{ PrismaClient }, { getSmtpConfiguration }, { emailPayloadEncryptionMode, isEmailPayloadEncryptionConfigured }] = await Promise.all([
    import("@prisma/client"),
    import("@/lib/email"),
    import("@/lib/email-outbox"),
  ]);
  const prisma = new PrismaClient();
  try {
    let smtpReady = true;
    try { getSmtpConfiguration(); } catch { smtpReady = false; }
    const encryptionReady = isEmailPayloadEncryptionConfigured();
    const now = new Date();
    const [rows, failedRows, heartbeat] = await Promise.all([
      prisma.emailOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.emailOutbox.groupBy({ by: ["template", "lastErrorCode"], where: { status: "FAILED" }, _count: { _all: true } }),
      readEmailWorkerHeartbeat(),
    ]);
    const counts = { pending: 0, processing: 0, sent: 0, failed: 0 };
    for (const row of rows) {
      if (row.status === "PENDING") counts.pending = row._count._all;
      else if (row.status === "PROCESSING") counts.processing = row._count._all;
      else if (row.status === "SENT") counts.sent = row._count._all;
      else if (row.status === "FAILED") counts.failed = row._count._all;
    }
    const failedDetails = failedRows.map(row => {
      const template = /^[A-Z0-9_]{1,40}$/.test(row.template) ? row.template : "OTHER";
      const code = row.lastErrorCode && /^[A-Z0-9_]{1,40}$/.test(row.lastErrorCode) ? row.lastErrorCode : "OTHER";
      return { template, errorCode: code, count: row._count._all };
    });
    const readyPendingCount = await prisma.emailOutbox.count({ where: { status: "PENDING", availableAt: { lte: now } } });
    const oldestReadyPending = await prisma.emailOutbox.findFirst({
      where: { status: "PENDING", availableAt: { lte: now } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const oldestReadyPendingAgeMs = oldestReadyPending ? Math.max(0, now.getTime() - oldestReadyPending.createdAt.getTime()) : null;
    const monitoring = evaluateEmailWorkerMonitoring({
      heartbeat,
      pendingCount: counts.pending,
      readyPendingCount,
      oldestReadyPendingAgeMs,
      failedCount: counts.failed,
      smtpConfigured: smtpReady,
      encryptionConfigured: encryptionReady,
    }, now);
    const recentFailures = await prisma.emailOutbox.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { template: true, attempts: true, lastErrorCode: true, retrySafe: true, updatedAt: true },
    });
    const result = {
      status: monitoring.status,
      database: "ready",
      smtp: smtpReady ? "configured" : "not-configured",
      smtpConnectivity: "not-checked",
      encryption: encryptionReady ? "ready" : "not-configured",
      encryptionKey: emailPayloadEncryptionMode(),
      worker: {
        state: monitoring.workerState,
        heartbeatAt: heartbeat?.heartbeatAt ?? null,
        lastPollStartedAt: heartbeat?.lastPollStartedAt ?? null,
        lastPollCompletedAt: heartbeat?.lastPollCompletedAt ?? null,
        lastSuccessfulPollAt: heartbeat?.lastSuccessfulPollAt ?? null,
        lastPollErrorCode: heartbeat?.lastPollErrorCode ?? null,
        lastPollErrorType: heartbeat?.lastPollErrorType ?? null,
        lastPollCounts: heartbeat?.lastPollProcessed === null || !heartbeat
          ? null
          : { processed: heartbeat.lastPollProcessed, sent: heartbeat.lastPollSent, failed: heartbeat.lastPollFailed },
      },
      outbox: {
        counts,
        readyPending: readyPendingCount,
        oldestReadyPendingAgeSeconds: oldestReadyPendingAgeMs === null ? null : Math.floor(oldestReadyPendingAgeMs / 1000),
        failedByCode: failedDetails,
        recentFailures: recentFailures.map(row => ({
          template: /^[A-Z0-9_]{1,40}$/.test(row.template) ? row.template : "OTHER",
          attempts: row.attempts,
          errorCode: row.lastErrorCode && /^[A-Z0-9_]{1,40}$/.test(row.lastErrorCode) ? row.lastErrorCode : "OTHER",
          retrySafe: row.retrySafe,
          updatedAt: row.updatedAt.toISOString(),
        })),
      },
      warnings: monitoring.warnings,
    };
    console.log(JSON.stringify(result));
    if (monitoring.status !== "healthy") process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const code = safeWorkerFailureCode(error);
  console.error(`Email outbox health check failed (${code}); verify database connectivity and required configuration.`);
  process.exitCode = 1;
});
