import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SecurityEventPayload } from "@/lib/security-event-ingestion";
import { hashSecurityEventId } from "@/lib/security-event-ingestion";
import { maskIpAddress } from "@/lib/admin-system-status";

export type SecurityEventRow = {
  id: string;
  sourceEventId: string;
  occurredAt: Date;
  receivedAt: Date;
  source: string;
  sourceIp: string | null;
  path: string | null;
  eventType: string;
  severity: string;
  action: string;
  ruleId: string | null;
};

type StoredSecurityEventRow = SecurityEventRow & { sourceIpMasked: string | null };

/** The dashboard never returns a raw IP: the stored mask, or the mask computed from a not-yet-masked row. */
export function displayIp(row: { sourceIp: string | null; sourceIpMasked: string | null }): string | null {
  if (row.sourceIpMasked) return row.sourceIpMasked;
  return row.sourceIp ? maskIpAddress(row.sourceIp) : null;
}

function toDisplayRow({ sourceIpMasked, ...row }: StoredSecurityEventRow): SecurityEventRow {
  return { ...row, sourceIp: displayIp({ sourceIp: row.sourceIp, sourceIpMasked }) };
}

/**
 * Repeated sources by MASKED address (one row per /16 or IPv6 /32 prefix), merging rows whose mask is stored with
 * older rows that still carry only the raw address.
 */
export function mergeRepeatedIps<T extends { sourceIp: string; sourceIpMasked: string | null; count: number; latestAt: Date; sources: string[]; eventTypes: string[]; critical: number; high: number }>(rows: T[]) {
  const merged = new Map<string, { sourceIp: string; count: number; latestAt: Date; sources: string[]; eventTypes: string[]; critical: number; high: number }>();
  for (const row of rows) {
    const key = displayIp(row) ?? "***";
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { sourceIp: key, count: row.count, latestAt: row.latestAt, sources: [...row.sources], eventTypes: [...row.eventTypes], critical: row.critical, high: row.high });
      continue;
    }
    current.count += row.count;
    current.critical += row.critical;
    current.high += row.high;
    if (row.latestAt > current.latestAt) current.latestAt = row.latestAt;
    current.sources = [...new Set([...current.sources, ...row.sources])];
    current.eventTypes = [...new Set([...current.eventTypes, ...row.eventTypes])];
  }
  return [...merged.values()]
    .sort((a, b) => b.critical - a.critical || b.high - a.high || b.count - a.count || b.latestAt.getTime() - a.latestAt.getTime())
    .slice(0, 8);
}

export type SecurityTimelineBucket = {
  index: number;
  count: number;
  critical: number;
  high: number;
};

export async function insertSecurityEvent(input: {
  source: "APPLICATION" | "CLOUDFLARE" | "APACHE_MODSECURITY";
  event: SecurityEventPayload;
}) {
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO "SecurityEvent" (
      "id", "source", "sourceEventId", "occurredAt", "sourceIp", "sourceIpMasked", "path",
      "eventType", "severity", "action", "ruleId", "createdAt"
    )
    VALUES (
      ${randomUUID()}, ${input.source}, ${hashSecurityEventId(input.source, input.event.eventId)}, ${new Date(input.event.occurredAt)},
      ${input.event.sourceIp ?? null}, ${input.event.sourceIp ? maskIpAddress(input.event.sourceIp) : null}, ${input.event.path ?? null}, ${input.event.eventType},
      ${input.event.severity}, ${input.event.action}, ${input.event.ruleId ?? null}, NOW()
    )
    ON CONFLICT ("source", "sourceEventId") DO NOTHING
    RETURNING "id"
  `);
  return rows.length ? { kind: "created" as const, id: rows[0].id } : { kind: "duplicate" as const };
}

export async function readSecurityEventDashboard(input: {
  search?: string;
  source?: string;
  severity?: string;
  eventType?: string;
  action?: string;
  windowStart: Date;
  previousWindowStart: Date;
  recentSince: Date;
  bucketCount: number;
  page: number;
  pageSize: number;
  now: Date;
}) {
  const conditions: Prisma.Sql[] = [];
  if (input.source) conditions.push(Prisma.sql`"source" = ${input.source}`);
  if (input.severity) conditions.push(Prisma.sql`"severity" = ${input.severity}`);
  if (input.eventType) conditions.push(Prisma.sql`"eventType" = ${input.eventType}`);
  if (input.action) conditions.push(Prisma.sql`"action" = ${input.action}`);
  if (input.search) {
    const query = input.search.toLocaleLowerCase("en-US");
    conditions.push(Prisma.sql`(
      STRPOS(LOWER("id"), ${query}) > 0 OR
      STRPOS(LOWER("sourceEventId"), ${query}) > 0 OR
      STRPOS(LOWER(COALESCE("sourceIp", '')), ${query}) > 0 OR
      STRPOS(LOWER(COALESCE("sourceIpMasked", '')), ${query}) > 0 OR
      STRPOS(LOWER(COALESCE("path", '')), ${query}) > 0 OR
      STRPOS(LOWER("eventType"), ${query}) > 0 OR
      STRPOS(LOWER("severity"), ${query}) > 0 OR
      STRPOS(LOWER("action"), ${query}) > 0 OR
      STRPOS(LOWER(COALESCE("ruleId", '')), ${query}) > 0
    )`);
  }
  const windowCondition = Prisma.sql`"occurredAt" >= ${input.windowStart} AND "occurredAt" <= ${input.now}`;
  const windowedConditions = [windowCondition, ...conditions];
  const where = Prisma.sql`WHERE ${Prisma.join(windowedConditions, " AND ")}`;
  const offset = (input.page - 1) * input.pageSize;

  const [
    totalRows,
    filteredRows,
    severityRows,
    repeatedLoginRows,
    eventRows,
    sourceActivityRows,
    typeRows,
    applicationTypeRows,
    actionRows,
    timelineRows,
    repeatedIpRows,
    priorityEventRows,
    trendRows,
  ] = await Promise.all([
    prisma.$queryRaw<{ count: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS "count" FROM "SecurityEvent" WHERE ${windowCondition}`),
    prisma.$queryRaw<{ count: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS "count" FROM "SecurityEvent" ${where}`),
    prisma.$queryRaw<{ severity: string; count: number }[]>(Prisma.sql`
      SELECT "severity", COUNT(*)::int AS "count" FROM "SecurityEvent" WHERE ${windowCondition} GROUP BY "severity"
    `),
    prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS "count"
      FROM (
        SELECT "sourceIp"
        FROM "SecurityEvent"
        WHERE "source" = 'APPLICATION'
          AND "eventType" = 'LOGIN_FAILURE'
          AND "occurredAt" >= ${input.recentSince}
          AND "occurredAt" <= ${input.now}
          AND "sourceIp" IS NOT NULL
        GROUP BY "sourceIp"
        HAVING COUNT(*) >= 5
      ) AS "repeatedSources"
    `),
    prisma.$queryRaw<StoredSecurityEventRow[]>(Prisma.sql`
      SELECT "id", "sourceEventId", "occurredAt", "createdAt" AS "receivedAt", "source", "sourceIp", "sourceIpMasked", "path", "eventType", "severity", "action", "ruleId"
      FROM "SecurityEvent" ${where}
      ORDER BY "occurredAt" DESC
      LIMIT ${input.pageSize} OFFSET ${offset}
    `),
    prisma.$queryRaw<{
      source: string;
      latestOccurredAt: Date;
      latestReceivedAt: Date;
      recentCount: number;
      windowCount: number;
    }[]>(Prisma.sql`
      SELECT
        "source",
        MAX("occurredAt") AS "latestOccurredAt",
        MAX("createdAt") AS "latestReceivedAt",
        COUNT(*) FILTER (
          WHERE "createdAt" >= ${input.recentSince} AND "createdAt" <= ${input.now}
        )::int AS "recentCount",
        COUNT(*) FILTER (
          WHERE "occurredAt" >= ${input.windowStart} AND "occurredAt" <= ${input.now}
        )::int AS "windowCount"
      FROM "SecurityEvent"
      GROUP BY "source"
    `),
    prisma.$queryRaw<{ eventType: string; count: number }[]>(Prisma.sql`
      SELECT "eventType", COUNT(*)::int AS "count"
      FROM "SecurityEvent" WHERE ${windowCondition}
      GROUP BY "eventType"
    `),
    prisma.$queryRaw<{ eventType: string; count: number }[]>(Prisma.sql`
      SELECT "eventType", COUNT(*)::int AS "count"
      FROM "SecurityEvent"
      WHERE "source" = 'APPLICATION' AND ${windowCondition}
      GROUP BY "eventType"
    `),
    prisma.$queryRaw<{ action: string; count: number }[]>(Prisma.sql`
      SELECT "action", COUNT(*)::int AS "count"
      FROM "SecurityEvent" WHERE ${windowCondition}
      GROUP BY "action"
    `),
    prisma.$queryRaw<SecurityTimelineBucket[]>(Prisma.sql`
      SELECT
        LEAST(
          ${input.bucketCount - 1},
          GREATEST(
            0,
            FLOOR(
              EXTRACT(EPOCH FROM ("occurredAt" - ${input.windowStart}))
              / (EXTRACT(EPOCH FROM (${input.now} - ${input.windowStart})) / ${input.bucketCount})
            )::int
          )
        ) AS "index",
        COUNT(*)::int AS "count",
        COUNT(*) FILTER (WHERE "severity" = 'CRITICAL')::int AS "critical",
        COUNT(*) FILTER (WHERE "severity" = 'HIGH')::int AS "high"
      FROM "SecurityEvent"
      WHERE ${windowCondition}
      GROUP BY "index"
      ORDER BY "index"
    `),
    prisma.$queryRaw<{
      sourceIp: string;
      sourceIpMasked: string | null;
      count: number;
      latestAt: Date;
      sources: string[];
      eventTypes: string[];
      critical: number;
      high: number;
    }[]>(Prisma.sql`
      SELECT
        COALESCE("sourceIp", "sourceIpMasked") AS "sourceIp",
        MAX("sourceIpMasked") AS "sourceIpMasked",
        COUNT(*)::int AS "count",
        MAX("occurredAt") AS "latestAt",
        ARRAY_AGG(DISTINCT "source") AS "sources",
        ARRAY_AGG(DISTINCT "eventType") AS "eventTypes",
        COUNT(*) FILTER (WHERE "severity" = 'CRITICAL')::int AS "critical",
        COUNT(*) FILTER (WHERE "severity" = 'HIGH')::int AS "high"
      FROM "SecurityEvent"
      WHERE ${windowCondition} AND COALESCE("sourceIp", "sourceIpMasked") IS NOT NULL
      GROUP BY COALESCE("sourceIp", "sourceIpMasked")
      HAVING COUNT(*) >= 2
      ORDER BY "critical" DESC, "high" DESC, "count" DESC, "latestAt" DESC
      LIMIT 64
    `),
    prisma.$queryRaw<StoredSecurityEventRow[]>(Prisma.sql`
      SELECT "id", "sourceEventId", "occurredAt", "createdAt" AS "receivedAt", "source", "sourceIp", "sourceIpMasked", "path", "eventType", "severity", "action", "ruleId"
      FROM "SecurityEvent"
      WHERE ${windowCondition} AND "severity" IN ('CRITICAL', 'HIGH')
      ORDER BY CASE "severity" WHEN 'CRITICAL' THEN 0 ELSE 1 END, "occurredAt" DESC
      LIMIT 6
    `),
    prisma.$queryRaw<{ currentCount: number; previousCount: number }[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (
          WHERE "occurredAt" >= ${input.windowStart} AND "occurredAt" <= ${input.now}
        )::int AS "currentCount",
        COUNT(*) FILTER (
          WHERE "occurredAt" >= ${input.previousWindowStart} AND "occurredAt" < ${input.windowStart}
        )::int AS "previousCount"
      FROM "SecurityEvent"
    `),
  ]);

  return {
    total: totalRows[0]?.count ?? 0,
    totalFiltered: filteredRows[0]?.count ?? 0,
    severity: Object.fromEntries(severityRows.map((row) => [row.severity, row.count])) as Record<string, number>,
    repeatedLoginSourcesLast15Minutes: repeatedLoginRows[0]?.count ?? 0,
    events: eventRows.map(toDisplayRow),
    timeline: timelineRows,
    repeatedIps: mergeRepeatedIps(repeatedIpRows).map((row) => ({
      ...row,
      latestAt: row.latestAt.toISOString(),
    })),
    priorityEvents: priorityEventRows.map(toDisplayRow),
    trend: trendRows[0] ?? { currentCount: 0, previousCount: 0 },
    sourceActivity: sourceActivityRows.map((row) => ({
      ...row,
      latestOccurredAt: row.latestOccurredAt.toISOString(),
      latestReceivedAt: row.latestReceivedAt.toISOString(),
    })),
    eventTypes: typeRows,
    applicationEventTypes: applicationTypeRows,
    actions: actionRows,
  };
}
