import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export const EMAIL_WORKER_HEARTBEAT_INTERVAL_MS = 20_000;
export const EMAIL_WORKER_STALE_AFTER_MS = 90_000;
export const EMAIL_WORKER_SUCCESS_STALE_AFTER_MS = 90_000;
export const EMAIL_OUTBOX_AGE_WARNING_MS = 5 * 60_000;

export type EmailWorkerHeartbeat = {
  version: 1;
  startedAt: string;
  heartbeatAt: string;
  lastPollStartedAt: string | null;
  lastPollCompletedAt: string | null;
  lastSuccessfulPollAt: string | null;
  lastPollErrorCode: string | null;
  lastPollErrorType: string | null;
  lastPollProcessed: number | null;
  lastPollSent: number | null;
  lastPollFailed: number | null;
  stoppedAt: string | null;
};

export type EmailWorkerMonitoringInput = {
  heartbeat: EmailWorkerHeartbeat | null;
  pendingCount: number;
  readyPendingCount: number;
  oldestReadyPendingAgeMs: number | null;
  failedCount: number;
  smtpConfigured: boolean;
  encryptionConfigured: boolean;
};

const errorTypes = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "URIError",
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientInitializationError",
  "PrismaClientValidationError",
  "PrismaClientRustPanicError",
  "SmtpConfigurationError",
]);

const databaseConnectionFailureCodes = new Set(["P1000", "P1001", "P1002", "P1008", "P1017", "P2024"]);

export function emailWorkerHeartbeatPath() {
  return join(process.cwd(), ".runtime", "email-worker-health.json");
}

export async function writeEmailWorkerHeartbeat(heartbeat: EmailWorkerHeartbeat) {
  const filePath = emailWorkerHeartbeatPath();
  const directory = join(process.cwd(), ".runtime");
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(heartbeat)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export async function readEmailWorkerHeartbeat(): Promise<EmailWorkerHeartbeat | null> {
  try {
    const value: unknown = JSON.parse(await readFile(emailWorkerHeartbeatPath(), "utf8"));
    return parseEmailWorkerHeartbeat(value);
  } catch {
    return null;
  }
}

export function parseEmailWorkerHeartbeat(value: unknown): EmailWorkerHeartbeat | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const dateOrNull = (candidate: unknown) => candidate === null || (typeof candidate === "string" && Number.isFinite(Date.parse(candidate)));
  const countOrNull = (candidate: unknown) => candidate === null || (typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0);
  if (
    record.version !== 1
    || typeof record.startedAt !== "string" || !Number.isFinite(Date.parse(record.startedAt))
    || typeof record.heartbeatAt !== "string" || !Number.isFinite(Date.parse(record.heartbeatAt))
    || !dateOrNull(record.lastPollStartedAt)
    || !dateOrNull(record.lastPollCompletedAt)
    || !dateOrNull(record.lastSuccessfulPollAt)
    || !dateOrNull(record.stoppedAt)
    || !(record.lastPollErrorCode === null || (typeof record.lastPollErrorCode === "string" && /^[A-Z0-9_]{1,40}$/.test(record.lastPollErrorCode)))
    || !(record.lastPollErrorType === null || (typeof record.lastPollErrorType === "string" && errorTypes.has(record.lastPollErrorType)))
    || !countOrNull(record.lastPollProcessed)
    || !countOrNull(record.lastPollSent)
    || !countOrNull(record.lastPollFailed)
  ) return null;
  return {
    version: 1,
    startedAt: record.startedAt as string,
    heartbeatAt: record.heartbeatAt as string,
    lastPollStartedAt: record.lastPollStartedAt as string | null,
    lastPollCompletedAt: record.lastPollCompletedAt as string | null,
    lastSuccessfulPollAt: record.lastSuccessfulPollAt as string | null,
    lastPollErrorCode: record.lastPollErrorCode as string | null,
    lastPollErrorType: record.lastPollErrorType as string | null,
    lastPollProcessed: record.lastPollProcessed as number | null,
    lastPollSent: record.lastPollSent as number | null,
    lastPollFailed: record.lastPollFailed as number | null,
    stoppedAt: record.stoppedAt as string | null,
  };
}

export function evaluateEmailWorkerMonitoring(input: EmailWorkerMonitoringInput, now = new Date()) {
  const warnings: string[] = [];
  let workerState: "unknown" | "stopped" | "stale" | "alive" = "unknown";
  const heartbeat = input.heartbeat;

  if (!heartbeat) {
    warnings.push("worker_not_observed");
  } else if (heartbeat.stoppedAt) {
    workerState = "stopped";
    warnings.push("worker_stopped");
  } else {
    const heartbeatAgeMs = now.getTime() - Date.parse(heartbeat.heartbeatAt);
    if (heartbeatAgeMs > EMAIL_WORKER_STALE_AFTER_MS) {
      workerState = "stale";
      warnings.push("worker_heartbeat_stale");
    } else {
      workerState = "alive";
    }
    if (!heartbeat.lastSuccessfulPollAt || now.getTime() - Date.parse(heartbeat.lastSuccessfulPollAt) > EMAIL_WORKER_SUCCESS_STALE_AFTER_MS) {
      warnings.push("worker_poll_not_recently_successful");
    }
    if (heartbeat.lastPollErrorCode) {
      warnings.push("worker_last_poll_failed");
      if (databaseConnectionFailureCodes.has(heartbeat.lastPollErrorCode)) warnings.push("worker_database_connection_failed");
    }
  }

  if (input.readyPendingCount > 0 && input.oldestReadyPendingAgeMs !== null && input.oldestReadyPendingAgeMs > EMAIL_OUTBOX_AGE_WARNING_MS) {
    warnings.push("pending_queue_age_exceeded");
  }
  if (input.failedCount > 0) warnings.push("failed_messages_present");
  if (!input.smtpConfigured) warnings.push("smtp_not_configured");
  if (!input.encryptionConfigured) warnings.push("payload_encryption_not_configured");

  return {
    status: warnings.length === 0 ? "healthy" as const : "warning" as const,
    workerState,
    warnings,
  };
}
