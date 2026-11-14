/**
 * Opportunistic Security Center jobs, run inside the Next.js app (no separate worker):
 *  - alert-rule evaluation (at most once a minute per process; one incident per rule per cooldown across processes),
 *  - hourly roll-up of minute counters (recomputed, idempotent),
 *  - retention (raw IP 7 days then masked only; minute stats 14 days; hourly stats 90 days).
 * Triggered after a telemetry flush and when an admin opens the live panel. Every job is throttled, idempotent and
 * fail-safe: errors are logged (error class only, at most once a minute) and never reach a request.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { utcTimestamp } from "@/lib/sql-timestamp";
import { maskIpAddress } from "@/lib/admin-system-status";
import {
  effectiveRuleSettings, incidentTitle, SECURITY_ALERT_RULES, shouldOpenIncident, TWO_FACTOR_PATHS, ADMIN_LOGIN_PATHS,
  type AlertRuleDefinition, type RuleSettings,
} from "@/lib/security-monitoring/rules";

export const RETENTION = { rawIpDays: 7, minuteStatDays: 14, hourStatDays: 90 } as const;
const RULES_INTERVAL_MS = 60_000;
const MAINTENANCE_INTERVAL_MS = 10 * 60_000;
const MASK_BATCH = 1_000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Db = PrismaClient | Prisma.TransactionClient;

export function retentionCutoffs(now: Date) {
  return {
    rawIpBefore: new Date(now.getTime() - RETENTION.rawIpDays * DAY_MS),
    minuteStatsBefore: new Date(now.getTime() - RETENTION.minuteStatDays * DAY_MS),
    hourStatsBefore: new Date(now.getTime() - RETENTION.hourStatDays * DAY_MS),
  };
}

const STAT_COLUMN: Record<string, Prisma.Sql> = {
  "stats.authDenied": Prisma.sql`"authDenied"`,
  "stats.notFound": Prisma.sql`"notFound"`,
  "stats.status5xx": Prisma.sql`"status5xx"`,
  "stats.rateLimited": Prisma.sql`"rateLimited"`,
  "stats.ipMismatches": Prisma.sql`"ipMismatches"`,
};

/** Value of a rule's metric over its window ending at `now`. */
export async function measureRule(db: Db, rule: AlertRuleDefinition, settings: RuleSettings, now: Date): Promise<number> {
  const since = new Date(now.getTime() - settings.windowMinutes * 60_000);
  if (rule.metric === "events.loginFailure") {
    return db.securityEvent.count({ where: { eventType: "LOGIN_FAILURE", occurredAt: { gte: since, lte: now } } });
  }
  if (rule.metric === "events.twoFactorFailure") {
    return db.securityEvent.count({ where: { eventType: "LOGIN_FAILURE", path: { in: [...TWO_FACTOR_PATHS] }, occurredAt: { gte: since, lte: now } } });
  }
  if (rule.metric === "events.adminLoginFailure") {
    return db.securityEvent.count({ where: { eventType: "LOGIN_FAILURE", path: { in: [...ADMIN_LOGIN_PATHS] }, occurredAt: { gte: since, lte: now } } });
  }
  const column = STAT_COLUMN[rule.metric];
  const rows = await db.$queryRaw<{ total: bigint | number | null }[]>`
    SELECT COALESCE(SUM(${column}), 0) AS total FROM "SecurityMinuteStat"
    WHERE "bucketStart" >= ${utcTimestamp(new Date(Math.floor(since.getTime() / 60_000) * 60_000))}`;
  return Number(rows[0]?.total ?? 0);
}

export async function loadRuleOverrides(db: Db): Promise<Map<string, RuleSettings>> {
  const rows = await db.securityAlertRule.findMany({ select: { key: true, enabled: true, threshold: true, windowMinutes: true, cooldownMinutes: true } });
  return new Map(rows.map((row) => [row.key, row]));
}

/** Evaluates every enabled rule; opens at most one incident per rule per cooldown (advisory lock per rule). */
export async function evaluateAlertRules(db: PrismaClient, now = new Date()): Promise<string[]> {
  const overrides = await loadRuleOverrides(db);
  const opened: string[] = [];
  for (const rule of SECURITY_ALERT_RULES) {
    const settings = effectiveRuleSettings(rule, overrides.get(rule.key));
    if (!settings.enabled) continue;
    const value = await measureRule(db, rule, settings, now);
    if (value < settings.threshold) continue;
    const created = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bagati-security-rule:${rule.key}`}))`;
      const last = await tx.securityIncident.findFirst({ where: { ruleKey: rule.key }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
      if (!shouldOpenIncident({ settings, value, lastIncidentAt: last?.createdAt ?? null, now })) return null;
      const incident = await tx.securityIncident.create({
        data: {
          ruleKey: rule.key,
          title: incidentTitle(rule, value, settings),
          severity: rule.severity,
          observedValue: value,
          threshold: settings.threshold,
          windowMinutes: settings.windowMinutes,
          windowStart: new Date(now.getTime() - settings.windowMinutes * 60_000),
          windowEnd: now,
          createdAt: now,
          notes: { create: { body: `Avtomatik açıldı: ${value} hadisə ${settings.windowMinutes} dəqiqədə (hədd ${settings.threshold}).`, createdAt: now } },
        },
        select: { id: true },
      });
      return incident.id;
    });
    if (created) opened.push(created);
  }
  return opened;
}

/** Recomputes the hourly rows of the last `hours` hours from minute rows (idempotent: SET, not add). */
export async function rollupHours(db: Db, now = new Date(), hours = 3): Promise<void> {
  const currentHour = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
  const from = new Date(currentHour - (hours - 1) * 3_600_000);
  await db.$executeRaw`
    INSERT INTO "SecurityHourStat" (
      "bucketStart", "routeGroup", "requests", "status4xx", "status5xx", "authDenied",
      "notFound", "rateLimited", "loginFailures", "ipMismatches", "durationMsSum", "durationMsMax"
    )
    SELECT date_trunc('hour', "bucketStart"), "routeGroup", SUM("requests"), SUM("status4xx"), SUM("status5xx"), SUM("authDenied"),
      SUM("notFound"), SUM("rateLimited"), SUM("loginFailures"), SUM("ipMismatches"), SUM("durationMsSum"), MAX("durationMsMax")
    FROM "SecurityMinuteStat"
    WHERE "bucketStart" >= ${utcTimestamp(from)}
    GROUP BY 1, 2
    ON CONFLICT ("bucketStart", "routeGroup") DO UPDATE SET
      "requests" = EXCLUDED."requests", "status4xx" = EXCLUDED."status4xx", "status5xx" = EXCLUDED."status5xx",
      "authDenied" = EXCLUDED."authDenied", "notFound" = EXCLUDED."notFound", "rateLimited" = EXCLUDED."rateLimited",
      "loginFailures" = EXCLUDED."loginFailures", "ipMismatches" = EXCLUDED."ipMismatches",
      "durationMsSum" = EXCLUDED."durationMsSum", "durationMsMax" = EXCLUDED."durationMsMax"`;
}

/**
 * Retention, idempotent:
 *  1. fills sourceIpMasked for events that have only the raw IP (batch),
 *  2. clears the raw IP of events older than 7 days (only where the masked form exists),
 *  3. deletes minute stats older than 14 days and hourly stats older than 90 days.
 */
export async function applyRetention(db: Db, now = new Date()): Promise<{ masked: number; rawCleared: number; minuteDeleted: number; hourDeleted: number }> {
  const cutoffs = retentionCutoffs(now);
  const pending = await db.securityEvent.findMany({ where: { sourceIp: { not: null }, sourceIpMasked: null }, select: { id: true, sourceIp: true }, take: MASK_BATCH });
  let masked = 0;
  if (pending.length) {
    const ids = pending.map((row) => row.id);
    const values = pending.map((row) => maskIpAddress(row.sourceIp));
    masked = await db.$executeRaw`
      UPDATE "SecurityEvent" AS e SET "sourceIpMasked" = v.masked
      FROM unnest(${ids}::text[], ${values}::text[]) AS v(id, masked)
      WHERE e."id" = v.id AND e."sourceIpMasked" IS NULL`;
  }
  const rawCleared = await db.$executeRaw`
    UPDATE "SecurityEvent" SET "sourceIp" = NULL
    WHERE "sourceIp" IS NOT NULL AND "sourceIpMasked" IS NOT NULL AND "occurredAt" < ${utcTimestamp(cutoffs.rawIpBefore)}`;
  const minuteDeleted = await db.$executeRaw`DELETE FROM "SecurityMinuteStat" WHERE "bucketStart" < ${utcTimestamp(cutoffs.minuteStatsBefore)}`;
  const hourDeleted = await db.$executeRaw`DELETE FROM "SecurityHourStat" WHERE "bucketStart" < ${utcTimestamp(cutoffs.hourStatsBefore)}`;
  return { masked, rawCleared, minuteDeleted, hourDeleted };
}

/** Maintenance (roll-up + retention) by one process at a time: a transaction-scoped try-lock. */
export async function runMaintenance(db: PrismaClient, now = new Date()): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('bagati-security-maintenance')) AS locked`;
    if (!lock?.locked) return false;
    await rollupHours(tx, now);
    await applyRetention(tx, now);
    return true;
  }, { timeout: 30_000 });
}

const state = (globalThis as unknown as { __bagatiSecurityJobs?: { rulesAt: number; maintenanceAt: number; running: boolean; errorLogAt: number } });
const jobs = state.__bagatiSecurityJobs ?? (state.__bagatiSecurityJobs = { rulesAt: -Infinity, maintenanceAt: -Infinity, running: false, errorLogAt: -Infinity });

function logJobError(job: string, error: unknown) {
  const now = Date.now();
  if (now - jobs.errorLogAt < 60_000) return;
  jobs.errorLogAt = now;
  console.error(JSON.stringify({ event: "security_monitoring.job_failed", job, error: error instanceof Error ? error.name : "unknown" }));
}

/** Throttled entry point; never throws. Returns what ran (for tests and the live API). */
export async function maybeRunMonitoringJobs(now = Date.now(), db: PrismaClient = prisma): Promise<{ rules: boolean; maintenance: boolean }> {
  const ran = { rules: false, maintenance: false };
  if (jobs.running) return ran;
  jobs.running = true;
  try {
    if (now - jobs.rulesAt >= RULES_INTERVAL_MS) {
      jobs.rulesAt = now;
      try { await evaluateAlertRules(db, new Date(now)); ran.rules = true; } catch (error) { logJobError("rules", error); }
    }
    if (now - jobs.maintenanceAt >= MAINTENANCE_INTERVAL_MS) {
      jobs.maintenanceAt = now;
      try { ran.maintenance = await runMaintenance(db, new Date(now)); } catch (error) { logJobError("maintenance", error); }
    }
  } finally {
    jobs.running = false;
  }
  return ran;
}

/** For tests: forget the throttle timestamps of this process. */
export function resetMonitoringJobThrottle() {
  jobs.rulesAt = -Infinity;
  jobs.maintenanceAt = -Infinity;
}
