import { Prisma, type PrismaClient } from "@prisma/client";
import {
  AUDIT_EXPORT_ACTION,
  AUDIT_EXPORT_MAX_ROWS,
  auditFiltersForAudit,
  bakuDayBounds,
  buildAuditLogCsv,
  escapeLikePattern,
  type AuditLogFilters,
} from "@/lib/admin-audit-log";
import { utcTimestamp } from "@/lib/sql-timestamp";

type Db = Pick<PrismaClient, "$transaction" | "user" | "auditLog">;
type Tx = Prisma.TransactionClient;

export type AuditLogRow = {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: Date;
};

const PAGE_STATEMENT_TIMEOUT_MS = 5_000;
const EXPORT_STATEMENT_TIMEOUT_MS = 15_000;
/** A real cuid can never equal this, so an unknown actor e-mail yields an empty result without a special case. */
const NO_SUCH_ACTOR = "-no-such-actor-";

export async function boundedRead<T>(db: Db, timeoutMs: number, work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
    return work(tx);
  }, { maxWait: 3_000, timeout: timeoutMs + 2_000 });
}

/** Resolves an actor e-mail through the unique User.email index; returns the actor id filter value. */
async function resolveActorId(db: Pick<PrismaClient, "user"> | Tx, filters: AuditLogFilters): Promise<string | null | undefined> {
  const actor = filters.actor;
  if (!actor) return undefined;
  if (actor.kind === "system") return null;
  if (actor.kind === "id") return actor.value;
  const user = await db.user.findUnique({ where: { email: actor.value }, select: { id: true } });
  return user?.id ?? NO_SUCH_ACTOR;
}

/**
 * WHERE clause for the filters. `actorId` is the resolved id: undefined = no actor filter, null = system entries.
 * Index notes: createdAt range → AuditLog_createdAt_idx; actorId (+ createdAt) → AuditLog_actorId_createdAt_idx.
 * action / entityType / entityId / free text have no index and are evaluated as filters on those scans.
 */
export function buildAuditWhere(filters: AuditLogFilters, actorId: string | null | undefined): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (actorId === null) conditions.push(Prisma.sql`a."actorId" IS NULL`);
  else if (actorId !== undefined) conditions.push(Prisma.sql`a."actorId" = ${actorId}`);
  if (filters.action) conditions.push(Prisma.sql`a."action" = ${filters.action}`);
  if (filters.entityType) conditions.push(Prisma.sql`a."entityType" = ${filters.entityType}`);
  if (filters.entityId) conditions.push(Prisma.sql`a."entityId" = ${filters.entityId}`);
  const from = filters.from ? bakuDayBounds(filters.from) : null;
  const to = filters.to ? bakuDayBounds(filters.to) : null;
  if (from) conditions.push(Prisma.sql`a."createdAt" >= ${utcTimestamp(from.start)}`);
  if (to) conditions.push(Prisma.sql`a."createdAt" < ${utcTimestamp(to.endExclusive)}`);
  if (filters.q) {
    const pattern = `%${escapeLikePattern(filters.q)}%`;
    conditions.push(Prisma.sql`(a."entityId" ILIKE ${pattern} ESCAPE '\\' OR a."metadata"::text ILIKE ${pattern} ESCAPE '\\')`);
  }
  return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
}

function selectRows(tx: Tx, where: Prisma.Sql, take: number, skip: number) {
  return tx.$queryRaw<AuditLogRow[]>`
    SELECT a."id", a."actorId", u."email" AS "actorEmail", u."role"::text AS "actorRole",
           a."action", a."entityType", a."entityId", a."metadata", a."createdAt"
    FROM "AuditLog" a
    LEFT JOIN "User" u ON u."id" = a."actorId"
    ${where}
    ORDER BY a."createdAt" DESC, a."id" DESC
    LIMIT ${take} OFFSET ${skip}`;
}

export async function findAuditLogPage(db: Db, filters: AuditLogFilters, page: { skip: number; take: number }) {
  return boundedRead(db, PAGE_STATEMENT_TIMEOUT_MS, async (tx) => {
    const where = buildAuditWhere(filters, await resolveActorId(tx, filters));
    const rows = await selectRows(tx, where, page.take, page.skip);
    const [count] = await tx.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS "total" FROM "AuditLog" a ${where}`;
    return { rows, total: Number(count?.total ?? 0) };
  });
}

type DistinctValues = { actions: string[]; entityTypes: string[] };
let distinctCache: { at: number; value: Promise<DistinctValues> } | null = null;
const DISTINCT_TTL_MS = 60_000;

/** Values for the action / entity type dropdowns. No index covers these columns, so the result is cached for 60s. */
export function auditDistinctValues(db: Db): Promise<DistinctValues> {
  const now = Date.now();
  if (distinctCache && now - distinctCache.at < DISTINCT_TTL_MS) return distinctCache.value;
  const value = boundedRead(db, PAGE_STATEMENT_TIMEOUT_MS, async (tx) => {
    const actions = await tx.$queryRaw<{ value: string }[]>`SELECT DISTINCT "action" AS "value" FROM "AuditLog" ORDER BY 1 LIMIT 500`;
    const entityTypes = await tx.$queryRaw<{ value: string }[]>`SELECT DISTINCT "entityType" AS "value" FROM "AuditLog" ORDER BY 1 LIMIT 500`;
    return { actions: actions.map((row) => row.value), entityTypes: entityTypes.map((row) => row.value) };
  });
  distinctCache = { at: now, value };
  value.catch(() => { if (distinctCache?.value === value) distinctCache = null; });
  return value;
}

/**
 * Builds the filtered CSV (at most AUDIT_EXPORT_MAX_ROWS rows) and records an AUDIT_EXPORT entry with the
 * filters and row count. The entry is written after the read, so it never appears in its own export.
 */
export async function exportAuditLogCsv(db: Db, adminId: string, filters: AuditLogFilters, maxRows = AUDIT_EXPORT_MAX_ROWS) {
  const rows = await boundedRead(db, EXPORT_STATEMENT_TIMEOUT_MS, async (tx) => {
    const where = buildAuditWhere(filters, await resolveActorId(tx, filters));
    return selectRows(tx, where, maxRows + 1, 0);
  });
  const result = buildAuditLogCsv(rows, maxRows);
  await db.auditLog.create({
    data: {
      actorId: adminId,
      action: AUDIT_EXPORT_ACTION,
      entityType: "AuditLog",
      entityId: null,
      metadata: { filters: auditFiltersForAudit(filters), rowCount: result.rowCount, truncated: result.truncated, maxRows },
    },
  });
  return result;
}
