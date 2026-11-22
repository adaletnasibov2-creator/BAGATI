/**
 * Read-only data for the admin security summary and the "Ətraflı hadisələr" list (SECURITY-PAGE-1).
 *
 * Every block runs in its own READ ONLY transaction with a 4 s statement timeout (boundedRead) and small LIMITs, one
 * block after another (no pool burst). A failing block is returned as null and shown as "unavailable"; the page still
 * opens. Only existing tables; no schema change.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { boundedRead } from "@/lib/admin-audit-log-query";
import { sessionReference } from "@/lib/admin-sessions";
import { SECURITY_AUDIT_ACTIONS } from "@/lib/audit-action-labels";
import { utcTimestamp } from "@/lib/sql-timestamp";
import { EVENT_WINDOWS, EVENTS_PAGE_SIZE, loginAuditBySession, NOT_FOUND_GROUPS, type EventWindow } from "@/lib/security-center-view";

export const SECURITY_PAGE_TIMEOUT_MS = 4_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

async function block<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | null> {
  try {
    return await boundedRead(prisma, SECURITY_PAGE_TIMEOUT_MS, work);
  } catch (error) {
    console.error(`security page block unavailable (${error instanceof Error ? error.name : "unknown"})`);
    return null;
  }
}

export async function loadAdmins() {
  return block(async (tx) => {
    const rows = await tx.user.findMany({
      where: { role: "ADMIN" },
      orderBy: { email: "asc" },
      take: 50,
      select: { id: true, email: true, isActive: true, adminTwoFactor: { select: { enrolledAt: true, lockedUntil: true } }, _count: { select: { adminRecoveryCodes: { where: { usedAt: null } } } } },
    });
    return rows.map((row) => ({
      id: row.id, email: row.email, isActive: row.isActive,
      twoFactorOn: Boolean(row.adminTwoFactor?.enrolledAt),
      lockedUntil: row.adminTwoFactor?.lockedUntil ?? null,
      unusedRecoveryCodes: row.adminTwoFactor?.enrolledAt ? row._count.adminRecoveryCodes : 0,
    }));
  });
}

/** The newest admin sessions of ALL admins; the full IP comes from the ADMIN_LOGIN audit row of the same session. */
export async function loadAdminLogins(now: Date) {
  return block(async (tx) => {
    const sessions = await tx.authSession.findMany({
      where: { user: { role: "ADMIN" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, userId: true, createdAt: true, lastSeenAt: true, expiresAt: true, revokedAt: true, ipMasked: true, userAgent: true, user: { select: { email: true } } },
    });
    const refs = [...new Set(sessions.map((session) => sessionReference(session.id)))];
    const audits = refs.length ? await tx.auditLog.findMany({
      where: { action: "ADMIN_LOGIN", entityType: "AuthSession", entityId: { in: refs } },
      select: { actorId: true, entityId: true, metadata: true },
      take: 100,
    }) : [];
    const byKey = loginAuditBySession(audits);
    return sessions.map((session) => {
      const audit = byKey.get(`${session.userId}:${sessionReference(session.id)}`);
      return {
        id: session.id, email: session.user.email, createdAt: session.createdAt, lastSeenAt: session.lastSeenAt,
        active: !session.revokedAt && session.expiresAt > now, ipMasked: session.ipMasked, ipFull: audit?.ip ?? null,
        method: audit?.method ?? null, device: session.userAgent,
      };
    });
  });
}

export async function loadFailedLogins(now: Date) {
  const since24h = new Date(now.getTime() - DAY_MS);
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  return block(async (tx) => {
    const byPath = await tx.$queryRaw<Array<{ path: string | null; last24h: number; last7d: number }>>`
      SELECT "path",
        COUNT(*) FILTER (WHERE "occurredAt" >= ${utcTimestamp(since24h)})::int AS "last24h",
        COUNT(*)::int AS "last7d"
      FROM "SecurityEvent"
      WHERE "eventType" = 'LOGIN_FAILURE' AND "occurredAt" >= ${utcTimestamp(since7d)}
      GROUP BY "path" ORDER BY "last7d" DESC LIMIT 20`;
    const recent = await tx.securityEvent.findMany({
      where: { eventType: "LOGIN_FAILURE", occurredAt: { gte: since7d } },
      orderBy: { occurredAt: "desc" },
      take: 20,
      select: { id: true, occurredAt: true, path: true, sourceIp: true, sourceIpMasked: true },
    });
    const adminTargeted = await tx.auditLog.findMany({
      where: { action: "ADMIN_LOGIN_FAILED", createdAt: { gte: since7d } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, createdAt: true, metadata: true, actor: { select: { email: true } } },
    });
    return {
      byPath: byPath.map((row) => ({ path: row.path, last24h: Number(row.last24h), last7d: Number(row.last7d) })),
      recent,
      adminTargeted: adminTargeted.map((row) => {
        const meta = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
        return { id: row.id, createdAt: row.createdAt, email: row.actor?.email ?? null, ip: typeof meta.ip === "string" ? meta.ip : null, portal: meta.portal, reason: meta.reason };
      }),
    };
  });
}

/** 404 probes, rate-limit hits and IP-header mismatches (counters), plus the busiest IPs with what they tried. */
export async function loadSuspicious(now: Date) {
  const since24h = new Date(now.getTime() - DAY_MS);
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  return block(async (tx) => {
    const groups = await tx.$queryRaw<Array<{ routeGroup: string; notFound24h: number; notFound7d: number; rateLimited24h: number; rateLimited7d: number; ipMismatches24h: number; ipMismatches7d: number }>>`
      SELECT "routeGroup",
        COALESCE(SUM("notFound") FILTER (WHERE "bucketStart" >= ${utcTimestamp(since24h)}), 0)::int AS "notFound24h",
        COALESCE(SUM("notFound"), 0)::int AS "notFound7d",
        COALESCE(SUM("rateLimited") FILTER (WHERE "bucketStart" >= ${utcTimestamp(since24h)}), 0)::int AS "rateLimited24h",
        COALESCE(SUM("rateLimited"), 0)::int AS "rateLimited7d",
        COALESCE(SUM("ipMismatches") FILTER (WHERE "bucketStart" >= ${utcTimestamp(since24h)}), 0)::int AS "ipMismatches24h",
        COALESCE(SUM("ipMismatches"), 0)::int AS "ipMismatches7d"
      FROM "SecurityMinuteStat"
      WHERE "bucketStart" >= ${utcTimestamp(since7d)}
      GROUP BY "routeGroup"`;
    const topIps = await tx.$queryRaw<Array<{ key: string; raw: string | null; masked: string | null; count: number; eventTypes: string[]; latestAt: Date }>>`
      SELECT COALESCE("sourceIp", "sourceIpMasked") AS "key", MAX("sourceIp") AS "raw", MAX("sourceIpMasked") AS "masked",
        COUNT(*)::int AS "count", ARRAY_AGG(DISTINCT "eventType") AS "eventTypes", MAX("occurredAt") AS "latestAt"
      FROM "SecurityEvent"
      WHERE "occurredAt" >= ${utcTimestamp(since7d)} AND COALESCE("sourceIp", "sourceIpMasked") IS NOT NULL
      GROUP BY COALESCE("sourceIp", "sourceIpMasked") ORDER BY "count" DESC LIMIT 10`;
    const keys = topIps.map((row) => row.key);
    const paths = keys.length ? await tx.$queryRaw<Array<{ key: string; path: string | null; count: number }>>`
      SELECT COALESCE("sourceIp", "sourceIpMasked") AS "key", "path", COUNT(*)::int AS "count"
      FROM "SecurityEvent"
      WHERE "occurredAt" >= ${utcTimestamp(since7d)} AND COALESCE("sourceIp", "sourceIpMasked") IN (${Prisma.join(keys)})
      GROUP BY 1, 2 ORDER BY "count" DESC LIMIT 60` : [];
    const sum = (field: "rateLimited24h" | "rateLimited7d" | "ipMismatches24h" | "ipMismatches7d") => groups.reduce((total, row) => total + Number(row[field]), 0);
    return {
      notFound: NOT_FOUND_GROUPS.map(({ group, label }) => {
        const row = groups.find((item) => item.routeGroup === group);
        return { group, label, last24h: Number(row?.notFound24h ?? 0), last7d: Number(row?.notFound7d ?? 0) };
      }),
      rateLimited: { last24h: sum("rateLimited24h"), last7d: sum("rateLimited7d") },
      ipMismatches: { last24h: sum("ipMismatches24h"), last7d: sum("ipMismatches7d") },
      topIps: topIps.map((row) => ({
        key: row.key, raw: row.raw, masked: row.masked, count: Number(row.count), eventTypes: row.eventTypes ?? [], latestAt: row.latestAt,
        paths: paths.filter((item) => item.key === row.key).slice(0, 3).map((item) => ({ path: item.path, count: Number(item.count) })),
      })),
    };
  });
}

export async function loadIncidentsAndHighEvents(now: Date) {
  const since7d = new Date(now.getTime() - 7 * DAY_MS);
  return block(async (tx) => {
    const incidents = await tx.securityIncident.findMany({
      where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, severity: true, status: true, createdAt: true },
    });
    const high = await tx.securityEvent.findMany({
      where: { severity: { in: ["HIGH", "CRITICAL"] }, occurredAt: { gte: since7d } },
      orderBy: { occurredAt: "desc" },
      take: 10,
      select: { id: true, occurredAt: true, eventType: true, severity: true, path: true, sourceIp: true, sourceIpMasked: true },
    });
    return { incidents, high };
  });
}

export async function loadSecurityAudit() {
  return block((tx) => tx.auditLog.findMany({
    where: { action: { in: [...SECURITY_AUDIT_ACTIONS] } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, action: true, createdAt: true, metadata: true, actor: { select: { email: true } } },
  }));
}

/** "Ətraflı hadisələr": one page of events (50) with filters; produced event types only. */
export async function listSecurityEvents(input: { window: EventWindow; eventType: string; severity: string; q: string; page: number }, now: Date) {
  const since = new Date(now.getTime() - EVENT_WINDOWS[input.window] * HOUR_MS);
  const where: Prisma.SecurityEventWhereInput = {
    occurredAt: { gte: since },
    ...(input.eventType ? { eventType: input.eventType } : {}),
    ...(input.severity ? { severity: input.severity } : {}),
    ...(input.q ? { OR: [{ path: { contains: input.q, mode: "insensitive" } }, { sourceIp: { contains: input.q } }, { sourceIpMasked: { contains: input.q } }] } : {}),
  };
  return block(async (tx) => {
    const total = await tx.securityEvent.count({ where });
    const rows = await tx.securityEvent.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      skip: (input.page - 1) * EVENTS_PAGE_SIZE,
      take: EVENTS_PAGE_SIZE,
      select: { id: true, occurredAt: true, source: true, eventType: true, severity: true, action: true, path: true, sourceIp: true, sourceIpMasked: true },
    });
    return { total, rows };
  });
}

/**
 * Full IPs are shown only after this audit row is written (who, which page, when). Returns false when the write fails,
 * and the page then keeps the masked IPs.
 */
export async function recordFullIpView(adminId: string, page: "summary" | "events"): Promise<boolean> {
  try {
    await prisma.auditLog.create({ data: { actorId: adminId, action: "SECURITY_FULL_IP_VIEW", entityType: "SecurityCenter", entityId: page, metadata: { page } } });
    return true;
  } catch (error) {
    console.error(`security full IP view not audited (${error instanceof Error ? error.name : "unknown"})`);
    return false;
  }
}
