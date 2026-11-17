/**
 * Database heartbeat for the email worker (table "EmailWorkerHeartbeat", one row id "email-outbox").
 *
 * Why the database and not the .runtime file: on Cloudways it is not known whether the app directory is writable or
 * survives a deploy, and with more than one app process only the database is shared. The CLI watch worker
 * (scripts/process-email-outbox.ts) still writes the file; the status card shows whichever heartbeat is newer.
 */
import type { PrismaClient } from "@prisma/client";
import { parseEmailWorkerHeartbeat, type EmailWorkerHeartbeat } from "@/lib/email-worker-monitoring";

export const EMAIL_WORKER_HEARTBEAT_ID = "email-outbox";

type HeartbeatClient = Pick<PrismaClient, "emailWorkerHeartbeat">;

const asDate = (value: string | null) => (value === null ? null : new Date(value));

export async function writeEmailWorkerHeartbeatToDatabase(client: HeartbeatClient, heartbeat: EmailWorkerHeartbeat) {
  const data = {
    startedAt: new Date(heartbeat.startedAt),
    heartbeatAt: new Date(heartbeat.heartbeatAt),
    lastPollStartedAt: asDate(heartbeat.lastPollStartedAt),
    lastPollCompletedAt: asDate(heartbeat.lastPollCompletedAt),
    lastSuccessfulPollAt: asDate(heartbeat.lastSuccessfulPollAt),
    lastPollErrorCode: heartbeat.lastPollErrorCode,
    lastPollErrorType: heartbeat.lastPollErrorType,
    lastPollProcessed: heartbeat.lastPollProcessed,
    lastPollSent: heartbeat.lastPollSent,
    lastPollFailed: heartbeat.lastPollFailed,
    stoppedAt: asDate(heartbeat.stoppedAt),
  };
  await client.emailWorkerHeartbeat.upsert({
    where: { id: EMAIL_WORKER_HEARTBEAT_ID },
    create: { id: EMAIL_WORKER_HEARTBEAT_ID, ...data },
    update: data,
    select: { id: true },
  });
}

/** Null when the row or the table is missing (for example before the migration) or the row is not well-formed. */
export async function readEmailWorkerHeartbeatFromDatabase(client: HeartbeatClient): Promise<EmailWorkerHeartbeat | null> {
  try {
    const row = await client.emailWorkerHeartbeat.findUnique({ where: { id: EMAIL_WORKER_HEARTBEAT_ID } });
    if (!row) return null;
    const iso = (value: Date | null) => (value === null ? null : value.toISOString());
    return parseEmailWorkerHeartbeat({
      version: 1,
      startedAt: row.startedAt.toISOString(),
      heartbeatAt: row.heartbeatAt.toISOString(),
      lastPollStartedAt: iso(row.lastPollStartedAt),
      lastPollCompletedAt: iso(row.lastPollCompletedAt),
      lastSuccessfulPollAt: iso(row.lastSuccessfulPollAt),
      lastPollErrorCode: row.lastPollErrorCode,
      lastPollErrorType: row.lastPollErrorType,
      lastPollProcessed: row.lastPollProcessed,
      lastPollSent: row.lastPollSent,
      lastPollFailed: row.lastPollFailed,
      stoppedAt: iso(row.stoppedAt),
    });
  } catch {
    return null;
  }
}

/** The more recent of two heartbeats (by heartbeatAt), with where it came from. */
export function newestEmailWorkerHeartbeat(database: EmailWorkerHeartbeat | null, file: EmailWorkerHeartbeat | null) {
  if (database && (!file || Date.parse(database.heartbeatAt) >= Date.parse(file.heartbeatAt))) return { heartbeat: database, source: "database" as const };
  if (file) return { heartbeat: file, source: "file" as const };
  return { heartbeat: null, source: null };
}
