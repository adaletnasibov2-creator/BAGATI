import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  IMPORT_JOB_STUCK_AFTER_MS,
  SYSTEM_STATUS_CACHE_TTL_MS,
  SYSTEM_STATUS_MIN_REFRESH_MS,
  SYSTEM_STATUS_STATEMENT_TIMEOUT_MS,
  bakuStartOfDay,
  createTtlCache,
  maskIpAddress,
  missingMigrations,
  postgresMajorVersion,
  type SystemStatusCard,
} from "@/lib/admin-system-status";
import { collectReadinessDetails } from "@/lib/readiness-signals";
import { utcTimestamp } from "@/lib/sql-timestamp";
import { storageReadinessMode } from "@/lib/storage/store-assets";
import { getSmtpConfiguration } from "@/lib/email";
import { emailPayloadEncryptionMode } from "@/lib/email-outbox";
import { evaluateEmailWorkerMonitoring, readEmailWorkerHeartbeat } from "@/lib/email-worker-monitoring";

type Tx = Prisma.TransactionClient;
type CountRow = { key: string; count: number };

/**
 * Runs one card's queries in a short read-only transaction with a per-statement timeout, so a slow
 * query fails that card alone instead of holding a connection.
 */
export async function boundedStatusRead<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${SYSTEM_STATUS_STATEMENT_TIMEOUT_MS}`);
    return work(tx);
  }, { maxWait: 2_000, timeout: SYSTEM_STATUS_STATEMENT_TIMEOUT_MS * 2 });
}

function countMap(rows: CountRow[]): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.key, Number(row.count)]));
}

async function repoMigrationFolders(): Promise<string[] | null> {
  try {
    const entries = await readdir(join(process.cwd(), "prisma", "migrations"), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return null;
  }
}

async function databaseCard() {
  const started = performance.now();
  await prisma.$queryRaw`SELECT 1`;
  const latencyMs = Math.round(performance.now() - started);
  return boundedStatusRead(async (tx) => {
    const [settings] = await tx.$queryRaw<{ timezone: string; version: string }[]>`
      SELECT current_setting('TimeZone') AS "timezone", current_setting('server_version_num') AS "version"`;
    const applied = await tx.$queryRaw<{ name: string; finishedAt: Date }[]>`
      SELECT "migration_name" AS "name", "finished_at" AS "finishedAt"
      FROM "_prisma_migrations"
      WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
      ORDER BY "finished_at" DESC
      LIMIT 1000`;
    const folders = await repoMigrationFolders();
    return {
      reachable: true,
      latencyMs,
      timezone: settings?.timezone ?? null,
      postgresMajor: postgresMajorVersion(settings?.version),
      appliedMigrations: applied.length,
      latestMigration: applied[0] ? { name: applied[0].name, finishedAt: applied[0].finishedAt.toISOString() } : null,
      repoMigrationsReadable: folders !== null,
      missingMigrations: folders ? missingMigrations(folders, applied.map((row) => row.name)) : [],
    };
  });
}

async function readinessCard() {
  return boundedStatusRead(async (tx) => {
    const details = await collectReadinessDetails(tx);
    return { storage: storageReadinessMode(), ...details };
  });
}

function smtpConfigured() {
  try { getSmtpConfiguration(); return true; } catch { return false; }
}

async function emailCard(now: Date) {
  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  const database = await boundedStatusRead(async (tx) => {
    const byStatus = await tx.$queryRaw<CountRow[]>`
      SELECT "status"::text AS "key", COUNT(*)::int AS "count" FROM "EmailOutbox" GROUP BY "status"`;
    const [oldest] = await tx.$queryRaw<{ oldest: Date | null }[]>`
      SELECT MIN("createdAt") AS "oldest" FROM "EmailOutbox" WHERE "status" = 'PENDING'`;
    // failedAt is cleared when a message is SENT, so restricting to the other statuses lets the
    // (status, availableAt) index skip the SENT bulk.
    const [failures] = await tx.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS "count" FROM "EmailOutbox"
      WHERE "status" IN ('PENDING', 'PROCESSING', 'FAILED') AND "failedAt" >= ${utcTimestamp(since)}`;
    return { byStatus: countMap(byStatus), oldestPendingAt: oldest?.oldest ?? null, failedLast24h: Number(failures?.count ?? 0) };
  });
  const heartbeat = await readEmailWorkerHeartbeat();
  const smtp = smtpConfigured();
  const encryptionMode = emailPayloadEncryptionMode();
  const encryption = encryptionMode !== "missing";
  const monitoring = evaluateEmailWorkerMonitoring({
    heartbeat,
    pendingCount: database.byStatus.PENDING ?? 0,
    readyPendingCount: database.byStatus.PENDING ?? 0,
    oldestReadyPendingAgeMs: database.oldestPendingAt ? now.getTime() - database.oldestPendingAt.getTime() : null,
    failedCount: database.byStatus.FAILED ?? 0,
    smtpConfigured: smtp,
    encryptionConfigured: encryption,
  }, now);
  return {
    byStatus: database.byStatus,
    oldestPendingAgeMs: database.oldestPendingAt ? Math.max(0, now.getTime() - database.oldestPendingAt.getTime()) : null,
    failedLast24h: database.failedLast24h,
    smtpConfigured: smtp,
    encryptionKeyConfigured: encryptionMode === "dedicated",
    encryptionUsable: encryption,
    workerState: monitoring.workerState,
    workerHeartbeatAt: heartbeat?.heartbeatAt ?? null,
  };
}

async function importsCard(now: Date) {
  const stuckBefore = new Date(now.getTime() - IMPORT_JOB_STUCK_AFTER_MS);
  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  return boundedStatusRead(async (tx) => {
    const byStatus = await tx.$queryRaw<CountRow[]>`
      SELECT "status"::text AS "key", COUNT(*)::int AS "count" FROM "ImportJob" GROUP BY "status"`;
    const [stuck] = await tx.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS "count" FROM "ImportJob"
      WHERE "status" IN ('UPLOADING', 'QUEUED', 'PROCESSING') AND "updatedAt" < ${utcTimestamp(stuckBefore)}`;
    const [failed] = await tx.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS "count" FROM "ImportJob"
      WHERE "status" = 'FAILED' AND "updatedAt" >= ${utcTimestamp(since)}`;
    const recent = await tx.$queryRaw<{ id: string; storeName: string; status: string; totalRows: number; processedRows: number; failedRows: number; createdAt: Date }[]>`
      SELECT j."id", s."name" AS "storeName", j."status"::text AS "status", j."totalRows", j."processedRows", j."failedRows", j."createdAt"
      FROM "ImportJob" j JOIN "Store" s ON s."id" = j."storeId"
      ORDER BY j."createdAt" DESC
      LIMIT 10`;
    return {
      byStatus: countMap(byStatus),
      stuckThresholdMinutes: IMPORT_JOB_STUCK_AFTER_MS / 60_000,
      stuck: Number(stuck?.count ?? 0),
      failedLast24h: Number(failed?.count ?? 0),
      recent: recent.map((job) => ({ ...job, createdAt: job.createdAt.toISOString() })),
    };
  });
}

async function securityCard(now: Date) {
  const since24h = new Date(now.getTime() - 24 * 60 * 60_000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  return boundedStatusRead(async (tx) => {
    const byType = await tx.$queryRaw<{ eventType: string; last24h: number; last7d: number }[]>`
      SELECT "eventType",
        COUNT(*) FILTER (WHERE "occurredAt" >= ${utcTimestamp(since24h)})::int AS "last24h",
        COUNT(*)::int AS "last7d"
      FROM "SecurityEvent"
      WHERE "occurredAt" >= ${utcTimestamp(since7d)} AND "occurredAt" <= ${utcTimestamp(now)}
      GROUP BY "eventType"
      ORDER BY "last7d" DESC
      LIMIT 20`;
    const repeated = await tx.$queryRaw<{ sourceIp: string; count: number }[]>`
      SELECT "sourceIp", COUNT(*)::int AS "count"
      FROM "SecurityEvent"
      WHERE "occurredAt" >= ${utcTimestamp(since7d)} AND "occurredAt" <= ${utcTimestamp(now)} AND "sourceIp" IS NOT NULL
      GROUP BY "sourceIp"
      HAVING COUNT(*) >= 2
      ORDER BY "count" DESC
      LIMIT 5`;
    return {
      byType: byType.map((row) => ({ eventType: row.eventType, last24h: Number(row.last24h), last7d: Number(row.last7d) })),
      repeatedIps: repeated.map((row) => ({ ip: maskIpAddress(row.sourceIp), count: Number(row.count) })),
    };
  });
}

async function businessCard(now: Date) {
  const today = bakuStartOfDay(now);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  return boundedStatusRead(async (tx) => {
    const [row] = await tx.$queryRaw<{ ordersToday: number; failedPaymentsToday: number; newSellers7d: number; pendingStoreReviews: number; unreadInquiries: number; pendingSellerApplications: number }[]>`
      SELECT
        (SELECT COUNT(*)::int FROM "Order" WHERE "createdAt" >= ${utcTimestamp(today)}) AS "ordersToday",
        (SELECT COUNT(*)::int FROM "Payment" WHERE "status" = 'FAILED' AND "createdAt" >= ${utcTimestamp(today)}) AS "failedPaymentsToday",
        (SELECT COUNT(*)::int FROM "User" WHERE "role" = 'VENDOR' AND "createdAt" >= ${utcTimestamp(since7d)}) AS "newSellers7d",
        (SELECT COUNT(*)::int FROM "Store" WHERE "status" = 'PENDING_REVIEW') AS "pendingStoreReviews",
        (SELECT COUNT(*)::int FROM "StoreInquiry" WHERE "status" = 'NEW') AS "unreadInquiries",
        (SELECT COUNT(*)::int FROM "VendorApplication" WHERE "status" = 'PENDING') AS "pendingSellerApplications"`;
    return {
      dayStartsAt: today.toISOString(),
      ordersToday: Number(row?.ordersToday ?? 0),
      failedPaymentsToday: Number(row?.failedPaymentsToday ?? 0),
      newSellers7d: Number(row?.newSellers7d ?? 0),
      pendingStoreReviews: Number(row?.pendingStoreReviews ?? 0),
      unreadInquiries: Number(row?.unreadInquiries ?? 0),
      pendingSellerApplications: Number(row?.pendingSellerApplications ?? 0),
    };
  });
}

async function readOptionalText(path: string, pattern: RegExp): Promise<string | null> {
  try {
    const value = (await readFile(path, "utf8")).trim();
    return pattern.test(value) ? value : null;
  } catch {
    return null;
  }
}

async function applicationCard() {
  const distDir = process.env.BAGATI_NEXT_DIST_DIR || ".next";
  const [buildId, packageJson] = await Promise.all([
    readOptionalText(join(process.cwd(), distDir, "BUILD_ID"), /^[\w-]{1,64}$/),
    readOptionalText(join(process.cwd(), "package.json"), /^\{/),
  ]);
  let version: string | null = null;
  try { version = packageJson ? String(JSON.parse(packageJson).version ?? "") || null : null; } catch { version = null; }
  const memory = process.memoryUsage();
  return {
    version,
    buildId,
    nodeVersion: process.version,
    environment: process.env.NODE_ENV ?? "unknown",
    uptimeSeconds: Math.round(process.uptime()),
    memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal },
  };
}

/** JSON shapes returned per card; every field is already JSON-safe (dates as ISO strings). */
export type SystemStatusData = {
  database: Awaited<ReturnType<typeof databaseCard>>;
  readiness: Awaited<ReturnType<typeof readinessCard>>;
  email: Awaited<ReturnType<typeof emailCard>>;
  imports: Awaited<ReturnType<typeof importsCard>>;
  security: Awaited<ReturnType<typeof securityCard>>;
  business: Awaited<ReturnType<typeof businessCard>>;
  application: Awaited<ReturnType<typeof applicationCard>>;
};

/** Uncached loaders (used by the cache below and by the verify-database test). */
export const systemStatusLoaders: Record<SystemStatusCard, (now: Date) => Promise<unknown>> = {
  database: () => databaseCard(),
  readiness: () => readinessCard(),
  email: emailCard,
  imports: importsCard,
  security: securityCard,
  business: businessCard,
  application: () => applicationCard(),
};

const cache = createTtlCache<{ generatedAt: string; data: unknown }>(SYSTEM_STATUS_CACHE_TTL_MS, SYSTEM_STATUS_MIN_REFRESH_MS);

export function loadSystemStatusCard(card: SystemStatusCard, options: { refresh?: boolean } = {}) {
  // Application metrics are process-local and cheap, so they are never served from cache.
  if (card === "application") return applicationCard().then((data) => ({ generatedAt: new Date().toISOString(), data }));
  return cache.get(card, async () => {
    const now = new Date();
    return { generatedAt: now.toISOString(), data: await systemStatusLoaders[card](now) };
  }, options);
}
