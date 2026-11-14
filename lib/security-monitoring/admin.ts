/**
 * Security Center admin operations (server-only): live snapshot, incidents (status, assignee, notes) and alert-rule
 * overrides. Every write runs in one transaction together with its AuditLog entry. Never returns a raw IP.
 */
import { Prisma, type PrismaClient, type SecurityIncidentStatus } from "@prisma/client";
import { utcTimestamp } from "@/lib/sql-timestamp";
import { displayIp } from "@/lib/security-event-store";
import { effectiveRuleSettings, getAlertRule, SECURITY_ALERT_RULES, type RuleSettings } from "@/lib/security-monitoring/rules";
import { minuteStart } from "@/lib/security-monitoring/telemetry";

export const INCIDENT_STATUSES = ["OPEN", "ACKNOWLEDGED", "RESOLVED", "FALSE_POSITIVE"] as const satisfies readonly SecurityIncidentStatus[];

/** Allowed status changes. Closed incidents can only be reopened; reopening clears the acknowledge/resolve marks. */
export const INCIDENT_TRANSITIONS: Record<SecurityIncidentStatus, readonly SecurityIncidentStatus[]> = {
  OPEN: ["ACKNOWLEDGED", "RESOLVED", "FALSE_POSITIVE"],
  ACKNOWLEDGED: ["OPEN", "RESOLVED", "FALSE_POSITIVE"],
  RESOLVED: ["OPEN"],
  FALSE_POSITIVE: ["OPEN"],
};

export const INCIDENT_STATUS_LABELS: Record<SecurityIncidentStatus, string> = {
  OPEN: "Açıq",
  ACKNOWLEDGED: "Qəbul edilib",
  RESOLVED: "Həll edilib",
  FALSE_POSITIVE: "Yanlış həyəcan",
};

export type SecurityAdminErrorCode = "NOT_FOUND" | "CONFLICT" | "INVALID_TRANSITION" | "INVALID_ASSIGNEE" | "UNKNOWN_RULE";

export class SecurityAdminError extends Error {
  constructor(readonly code: SecurityAdminErrorCode) {
    super(code);
    this.name = "SecurityAdminError";
  }
}

export const SECURITY_ADMIN_ERROR_RESPONSES: Record<SecurityAdminErrorCode, { status: number; error: string }> = {
  NOT_FOUND: { status: 404, error: "Tapılmadı." },
  CONFLICT: { status: 409, error: "Məlumat başqa admin tərəfindən dəyişdirilib. Səhifəni yeniləyin." },
  INVALID_TRANSITION: { status: 422, error: "Bu status dəyişikliyinə icazə verilmir." },
  INVALID_ASSIGNEE: { status: 422, error: "Məsul şəxs admin olmalıdır." },
  UNKNOWN_RULE: { status: 404, error: "Belə qayda yoxdur." },
};

export function canTransition(from: SecurityIncidentStatus, to: SecurityIncidentStatus): boolean {
  return INCIDENT_TRANSITIONS[from].includes(to);
}

/** Fields written when the status changes (CHECK: RESOLVED / FALSE_POSITIVE require resolvedAt). */
export function transitionFields(to: SecurityIncidentStatus, actorId: string, now: Date) {
  if (to === "OPEN") return { status: to, acknowledgedAt: null, acknowledgedById: null, resolvedAt: null, resolvedById: null };
  if (to === "ACKNOWLEDGED") return { status: to, acknowledgedAt: now, acknowledgedById: actorId, resolvedAt: null, resolvedById: null };
  return { status: to, resolvedAt: now, resolvedById: actorId };
}

const COUNTER_FIELDS = ["requests", "status4xx", "status5xx", "authDenied", "notFound", "rateLimited", "loginFailures", "ipMismatches"] as const;
type CounterField = (typeof COUNTER_FIELDS)[number];
export type MinutePoint = { minute: string } & Record<CounterField, number>;

const emptyCounters = (): Record<CounterField, number> => ({ requests: 0, status4xx: 0, status5xx: 0, authDenied: 0, notFound: 0, rateLimited: 0, loginFailures: 0, ipMismatches: 0 });

/** Exactly `minutes` points ending at the current minute; minutes without rows are zero. */
export function fillMinuteSeries(rows: Array<{ bucketStart: Date } & Partial<Record<CounterField, number | bigint | null>>>, now: Date, minutes = 60): MinutePoint[] {
  const end = minuteStart(now.getTime()).getTime();
  const byMinute = new Map(rows.map((row) => [row.bucketStart.getTime(), row]));
  const points: MinutePoint[] = [];
  for (let index = minutes - 1; index >= 0; index -= 1) {
    const time = end - index * 60_000;
    const row = byMinute.get(time);
    const counters = emptyCounters();
    if (row) for (const field of COUNTER_FIELDS) counters[field] = Number(row[field] ?? 0);
    points.push({ minute: new Date(time).toISOString(), ...counters });
  }
  return points;
}

export function sumPoints(points: readonly MinutePoint[]): Record<CounterField, number> {
  const total = emptyCounters();
  for (const point of points) for (const field of COUNTER_FIELDS) total[field] += point[field];
  return total;
}

const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10_000) / 100 : 0);

export async function readLiveSnapshot(db: PrismaClient, now = new Date()) {
  const since = new Date(minuteStart(now.getTime()).getTime() - 59 * 60_000);
  const sinceSql = utcTimestamp(since);
  const day = new Date(now.getTime() - 24 * 60 * 60_000);
  const [minuteRows, groupRows, latestStat, events, openIncidents, statusCounts, sourceRows] = await Promise.all([
    db.$queryRaw<Array<{ bucketStart: Date } & Record<CounterField, number>>>`
      SELECT "bucketStart",
        SUM("requests")::int AS "requests", SUM("status4xx")::int AS "status4xx", SUM("status5xx")::int AS "status5xx",
        SUM("authDenied")::int AS "authDenied", SUM("notFound")::int AS "notFound", SUM("rateLimited")::int AS "rateLimited",
        SUM("loginFailures")::int AS "loginFailures", SUM("ipMismatches")::int AS "ipMismatches"
      FROM "SecurityMinuteStat" WHERE "bucketStart" >= ${sinceSql}
      GROUP BY "bucketStart" ORDER BY "bucketStart"`,
    db.$queryRaw<Array<{ routeGroup: string; requests: number; status4xx: number; status5xx: number; authDenied: number; notFound: number; rateLimited: number; avgMs: number | null; maxMs: number }>>`
      SELECT "routeGroup",
        SUM("requests")::int AS "requests", SUM("status4xx")::int AS "status4xx", SUM("status5xx")::int AS "status5xx",
        SUM("authDenied")::int AS "authDenied", SUM("notFound")::int AS "notFound", SUM("rateLimited")::int AS "rateLimited",
        CASE WHEN SUM("requests") > 0 THEN ROUND(SUM("durationMsSum")::numeric / SUM("requests"))::int END AS "avgMs",
        MAX("durationMsMax")::int AS "maxMs"
      FROM "SecurityMinuteStat" WHERE "bucketStart" >= ${sinceSql}
      GROUP BY "routeGroup" ORDER BY SUM("requests") DESC, "routeGroup" LIMIT 10`,
    db.securityMinuteStat.findFirst({ orderBy: { bucketStart: "desc" }, select: { bucketStart: true } }),
    db.securityEvent.findMany({
      orderBy: { occurredAt: "desc" }, take: 20,
      select: { id: true, occurredAt: true, source: true, eventType: true, severity: true, action: true, path: true, sourceIp: true, sourceIpMasked: true },
    }),
    db.securityIncident.findMany({
      where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, ruleKey: true, title: true, severity: true, status: true, observedValue: true, threshold: true, createdAt: true, assignee: { select: { email: true } } },
    }),
    db.securityIncident.groupBy({ by: ["status"], _count: { _all: true } }),
    db.securityEvent.groupBy({ by: ["source"], where: { createdAt: { gte: day } }, _count: { _all: true }, _max: { createdAt: true } }),
  ]);
  const series = fillMinuteSeries(minuteRows, now);
  const last60 = sumPoints(series);
  const last5 = sumPoints(series.slice(-5));
  const source = (name: string) => sourceRows.find((row) => row.source === name);
  return {
    generatedAt: now.toISOString(),
    series,
    totals: {
      last60: { ...last60, rate5xx: rate(last60.status5xx, last60.requests), rate4xx: rate(last60.status4xx, last60.requests), rateAuthDenied: rate(last60.authDenied, last60.requests) },
      last5: { ...last5, rate5xx: rate(last5.status5xx, last5.requests), rate4xx: rate(last5.status4xx, last5.requests), rateAuthDenied: rate(last5.authDenied, last5.requests) },
    },
    routeGroups: groupRows,
    latestStatMinute: latestStat?.bucketStart.toISOString() ?? null,
    recentEvents: events.map(({ sourceIp, sourceIpMasked, occurredAt, ...event }) => ({ ...event, occurredAt: occurredAt.toISOString(), ip: displayIp({ sourceIp, sourceIpMasked }) })),
    openIncidents: openIncidents.map(({ assignee, createdAt, ...incident }) => ({ ...incident, createdAt: createdAt.toISOString(), assignee: assignee?.email ?? null })),
    incidentCounts: Object.fromEntries(INCIDENT_STATUSES.map((status) => [status, statusCounts.find((row) => row.status === status)?._count._all ?? 0])) as Record<SecurityIncidentStatus, number>,
    sources: {
      application: { state: "active" as const, eventsLast24h: source("APPLICATION")?._count._all ?? 0, lastReceivedAt: source("APPLICATION")?._max.createdAt?.toISOString() ?? null },
      cloudflare: { state: "relay" as const, eventsLast24h: source("CLOUDFLARE")?._count._all ?? 0, lastReceivedAt: source("CLOUDFLARE")?._max.createdAt?.toISOString() ?? null },
      // The Apache / ModSecurity receiver stays in the code but is not used in this deployment.
      apache: { state: "not_in_use" as const, eventsLast24h: source("APACHE_MODSECURITY")?._count._all ?? 0, lastReceivedAt: source("APACHE_MODSECURITY")?._max.createdAt?.toISOString() ?? null },
    },
  };
}

const incidentSelect = {
  id: true, ruleKey: true, title: true, severity: true, status: true, observedValue: true, threshold: true, windowMinutes: true,
  windowStart: true, windowEnd: true, acknowledgedAt: true, resolvedAt: true, createdAt: true, updatedAt: true,
  assigneeId: true,
  assignee: { select: { email: true } },
  acknowledgedBy: { select: { email: true } },
  resolvedBy: { select: { email: true } },
  _count: { select: { notes: true } },
} satisfies Prisma.SecurityIncidentSelect;

type IncidentRow = Prisma.SecurityIncidentGetPayload<{ select: typeof incidentSelect }>;

function serializeIncident(row: IncidentRow) {
  const { assignee, acknowledgedBy, resolvedBy, _count, ...rest } = row;
  return {
    ...rest,
    windowStart: rest.windowStart.toISOString(),
    windowEnd: rest.windowEnd.toISOString(),
    acknowledgedAt: rest.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: rest.resolvedAt?.toISOString() ?? null,
    createdAt: rest.createdAt.toISOString(),
    updatedAt: rest.updatedAt.toISOString(),
    assignee: assignee?.email ?? null,
    acknowledgedBy: acknowledgedBy?.email ?? null,
    resolvedBy: resolvedBy?.email ?? null,
    noteCount: _count.notes,
    allowedTransitions: INCIDENT_TRANSITIONS[rest.status],
  };
}

export async function listIncidents(db: PrismaClient, input: { status?: SecurityIncidentStatus; page: number; pageSize: number }) {
  const where = input.status ? { status: input.status } : {};
  const [items, total, assignees] = await Promise.all([
    db.securityIncident.findMany({ where, orderBy: { createdAt: "desc" }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, select: incidentSelect }),
    db.securityIncident.count({ where }),
    db.user.findMany({ where: { role: "ADMIN" }, orderBy: { email: "asc" }, take: 100, select: { id: true, email: true } }),
  ]);
  return { items: items.map(serializeIncident), total, page: input.page, pageSize: input.pageSize, assignees };
}

export async function readIncident(db: PrismaClient, id: string) {
  const row = await db.securityIncident.findUnique({ where: { id }, select: incidentSelect });
  if (!row) throw new SecurityAdminError("NOT_FOUND");
  const notes = await db.securityIncidentNote.findMany({
    where: { incidentId: id }, orderBy: { createdAt: "asc" }, take: 200,
    select: { id: true, body: true, createdAt: true, author: { select: { email: true } } },
  });
  return { ...serializeIncident(row), notes: notes.map((note) => ({ id: note.id, body: note.body, createdAt: note.createdAt.toISOString(), author: note.author?.email ?? "Sistem" })) };
}

/**
 * Status and/or assignee change. Optimistic: the caller sends the status it saw (`expectedStatus`); the update only
 * applies while the row still has that status, so two admins cannot silently overwrite each other.
 */
export async function updateIncident(db: PrismaClient, input: {
  id: string; actorId: string; expectedStatus: SecurityIncidentStatus; status?: SecurityIncidentStatus; assigneeId?: string | null; comment?: string | null; now?: Date;
}) {
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const current = await tx.securityIncident.findUnique({ where: { id: input.id }, select: { id: true, status: true, ruleKey: true, assigneeId: true } });
    if (!current) throw new SecurityAdminError("NOT_FOUND");
    if (current.status !== input.expectedStatus) throw new SecurityAdminError("CONFLICT");
    const statusChange = input.status !== undefined && input.status !== current.status ? input.status : undefined;
    if (statusChange && !canTransition(current.status, statusChange)) throw new SecurityAdminError("INVALID_TRANSITION");
    const assigneeChange = input.assigneeId !== undefined && input.assigneeId !== current.assigneeId;
    if (assigneeChange && input.assigneeId) {
      const assignee = await tx.user.findUnique({ where: { id: input.assigneeId }, select: { role: true } });
      if (assignee?.role !== "ADMIN") throw new SecurityAdminError("INVALID_ASSIGNEE");
    }
    if (!statusChange && !assigneeChange && !input.comment) return { changed: false };

    const data = {
      ...(statusChange ? transitionFields(statusChange, input.actorId, now) : {}),
      ...(assigneeChange ? { assigneeId: input.assigneeId ?? null } : {}),
      updatedAt: now,
    };
    const updated = await tx.securityIncident.updateMany({ where: { id: input.id, status: current.status }, data });
    if (updated.count !== 1) throw new SecurityAdminError("CONFLICT");

    const lines: string[] = [];
    if (statusChange) lines.push(`Status: ${INCIDENT_STATUS_LABELS[current.status]} → ${INCIDENT_STATUS_LABELS[statusChange]}`);
    if (assigneeChange) lines.push(input.assigneeId ? "Məsul şəxs təyin edildi" : "Məsul şəxs götürüldü");
    if (input.comment) lines.push(input.comment);
    await tx.securityIncidentNote.create({ data: { incidentId: input.id, authorId: input.actorId, body: lines.join("\n").slice(0, 2000) } });

    if (statusChange) {
      await tx.auditLog.create({ data: {
        actorId: input.actorId, action: "SECURITY_INCIDENT_STATUS", entityType: "SecurityIncident", entityId: input.id,
        metadata: { ruleKey: current.ruleKey, from: current.status, to: statusChange },
      } });
    }
    if (assigneeChange) {
      await tx.auditLog.create({ data: {
        actorId: input.actorId, action: "SECURITY_INCIDENT_ASSIGN", entityType: "SecurityIncident", entityId: input.id,
        metadata: { ruleKey: current.ruleKey, from: current.assigneeId, to: input.assigneeId ?? null },
      } });
    }
    return { changed: true };
  });
}

export async function addIncidentNote(db: PrismaClient, input: { id: string; actorId: string; body: string }) {
  return db.$transaction(async (tx) => {
    const incident = await tx.securityIncident.findUnique({ where: { id: input.id }, select: { id: true, ruleKey: true } });
    if (!incident) throw new SecurityAdminError("NOT_FOUND");
    const note = await tx.securityIncidentNote.create({ data: { incidentId: input.id, authorId: input.actorId, body: input.body }, select: { id: true } });
    await tx.securityIncident.update({ where: { id: input.id }, data: { updatedAt: new Date() } });
    // The note text is not copied into the audit log (it is kept on the incident).
    await tx.auditLog.create({ data: {
      actorId: input.actorId, action: "SECURITY_INCIDENT_NOTE", entityType: "SecurityIncident", entityId: input.id,
      metadata: { ruleKey: incident.ruleKey, noteId: note.id, length: input.body.length },
    } });
    return note;
  });
}

export async function listRules(db: PrismaClient) {
  const rows = await db.securityAlertRule.findMany({ include: { updatedBy: { select: { email: true } } } });
  return SECURITY_ALERT_RULES.map((rule) => {
    const row = rows.find((item) => item.key === rule.key);
    const effective = effectiveRuleSettings(rule, row ?? null);
    return {
      key: rule.key, label: rule.label, description: rule.description, severity: rule.severity, metric: rule.metric,
      defaults: rule.defaults,
      settings: { enabled: effective.enabled, threshold: effective.threshold, windowMinutes: effective.windowMinutes, cooldownMinutes: effective.cooldownMinutes },
      isDefault: effective.isDefault,
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy?.email ?? null,
    };
  });
}

/** Saves an override. `expectedVersion` is the version the admin saw (0 = no override yet). */
export async function updateRule(db: PrismaClient, input: { key: string; actorId: string; settings: RuleSettings; expectedVersion: number }) {
  const rule = getAlertRule(input.key);
  if (!rule) throw new SecurityAdminError("UNKNOWN_RULE");
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.securityAlertRule.findUnique({ where: { key: rule.key } });
      if ((existing?.version ?? 0) !== input.expectedVersion) throw new SecurityAdminError("CONFLICT");
      const before = effectiveRuleSettings(rule, existing);
      let version: number;
      if (existing) {
        const updated = await tx.securityAlertRule.updateMany({
          where: { key: rule.key, version: input.expectedVersion },
          data: { ...input.settings, version: { increment: 1 }, updatedById: input.actorId },
        });
        if (updated.count !== 1) throw new SecurityAdminError("CONFLICT");
        version = input.expectedVersion + 1;
      } else {
        await tx.securityAlertRule.create({ data: { key: rule.key, ...input.settings, version: 1, updatedById: input.actorId } });
        version = 1;
      }
      await tx.auditLog.create({ data: {
        actorId: input.actorId, action: "SECURITY_RULE_UPDATE", entityType: "SecurityAlertRule", entityId: rule.key,
        metadata: { key: rule.key, change: "update", before: settingsOnly(before), after: input.settings, version },
      } });
      return { version };
    });
  } catch (error) {
    // Two admins creating the first override at the same time: the loser hits the primary key.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new SecurityAdminError("CONFLICT");
    throw error;
  }
}

/** Removes the override so the code default applies again. */
export async function resetRule(db: PrismaClient, input: { key: string; actorId: string; expectedVersion: number }) {
  const rule = getAlertRule(input.key);
  if (!rule) throw new SecurityAdminError("UNKNOWN_RULE");
  return db.$transaction(async (tx) => {
    const existing = await tx.securityAlertRule.findUnique({ where: { key: rule.key } });
    if ((existing?.version ?? 0) !== input.expectedVersion) throw new SecurityAdminError("CONFLICT");
    if (!existing) return { version: 0, changed: false };
    const deleted = await tx.securityAlertRule.deleteMany({ where: { key: rule.key, version: input.expectedVersion } });
    if (deleted.count !== 1) throw new SecurityAdminError("CONFLICT");
    await tx.auditLog.create({ data: {
      actorId: input.actorId, action: "SECURITY_RULE_UPDATE", entityType: "SecurityAlertRule", entityId: rule.key,
      metadata: { key: rule.key, change: "reset", before: settingsOnly(effectiveRuleSettings(rule, existing)), after: rule.defaults },
    } });
    return { version: 0, changed: true };
  });
}

function settingsOnly(settings: RuleSettings): RuleSettings {
  return { enabled: settings.enabled, threshold: settings.threshold, windowMinutes: settings.windowMinutes, cooldownMinutes: settings.cooldownMinutes };
}
