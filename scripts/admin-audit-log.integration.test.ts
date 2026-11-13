/**
 * Audit log filters, CSV export and the system status cards against the isolated verification PostgreSQL cluster.
 *
 * Safety: uses ONLY BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL and refuses unless the host is loopback, the port is
 * exactly 5433 and the database name contains "verify". It never reads .env (DATABASE_URL is overwritten in-process
 * with the verify URL before lib/prisma is imported) and never connects to 5432. Fixture rows use a unique entity
 * type and are deleted in `finally`. Skips (NOT VERIFIED) when the cluster is unreachable; it never migrates.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const VERIFY_URL_ENV = "BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL";

function guardedVerifyUrl(): { url: string } | { refuse: string } | { skip: string } {
  const raw = process.env[VERIFY_URL_ENV];
  if (!raw) return { skip: `${VERIFY_URL_ENV} is not set` };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { refuse: `${VERIFY_URL_ENV} is not a valid URL` }; }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return { refuse: "verify database host must be loopback" };
  if (parsed.port !== "5433") return { refuse: "verify database port must be exactly 5433" };
  if (!database.includes("verify")) return { refuse: "verify database name must contain \"verify\"" };
  return { url: raw };
}

test("audit log filters, export and system status cards on the verify database", { timeout: 120_000 }, async (t) => {
  const guard = guardedVerifyUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;

  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = randomUUID().replace(/-/g, "").slice(0, 10);
  const entityType = `VerifyAudit_${tag}`;
  const userIds: string[] = [];
  try {
    let where: Array<{ db: string; port: number }>;
    try { where = await prisma.$queryRaw`SELECT current_database() AS db, inet_server_port() AS port`; }
    catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    assert.ok(where[0]?.db.includes("verify"));
    assert.equal(Number(where[0]?.port), 5433);

    const { findAuditLogPage, exportAuditLogCsv } = await import("../lib/admin-audit-log-query");
    const { parseAuditLogFilters } = await import("../lib/admin-audit-log");
    const { loadSystemStatusCard } = await import("../lib/admin-system-status-cards");
    const { SYSTEM_STATUS_CARDS } = await import("../lib/admin-system-status");

    const admin = await prisma.user.create({ data: { email: `audit-admin-${tag}@verify.invalid`, passwordHash: "x", role: "ADMIN" } });
    const other = await prisma.user.create({ data: { email: `audit-other-${tag}@verify.invalid`, passwordHash: "x", role: "VENDOR" } });
    userIds.push(admin.id, other.id);

    // Baku dates: 2020-01-10 08:00 UTC = 12:00 Baku; 2020-01-10 21:00 UTC = 2020-01-11 01:00 Baku.
    await prisma.auditLog.createMany({ data: [
      { actorId: admin.id, action: "VERIFY_A", entityType, entityId: "e-1", metadata: { note: "alpha 50% off", ip: "203.0.113.9" }, createdAt: new Date("2020-01-10T08:00:00Z") },
      { actorId: admin.id, action: "VERIFY_B", entityType, entityId: "e-2", metadata: { note: "=HYPERLINK(1)" }, createdAt: new Date("2020-01-10T21:00:00Z") },
      { actorId: other.id, action: "VERIFY_A", entityType, entityId: "e-3", metadata: { note: "beta" }, createdAt: new Date("2020-01-12T08:00:00Z") },
      { actorId: null, action: "VERIFY_A", entityType, entityId: "e_4", createdAt: new Date("2020-01-12T09:00:00Z") },
    ] });

    const run = async (params: Record<string, string>, page = { skip: 0, take: 25 }) => {
      const { filters, errors } = parseAuditLogFilters({ entityType, ...params });
      assert.deepEqual(errors, []);
      return findAuditLogPage(prisma, filters, page);
    };
    const ids = (rows: { entityId: string | null }[]) => rows.map((row) => row.entityId);

    assert.deepEqual(ids((await run({})).rows), ["e_4", "e-3", "e-2", "e-1"], "newest first");
    assert.equal((await run({})).total, 4);
    assert.deepEqual(ids((await run({ action: "VERIFY_A" })).rows), ["e_4", "e-3", "e-1"]);
    assert.deepEqual(ids((await run({ entityId: "e-2" })).rows), ["e-2"]);
    assert.deepEqual(ids((await run({ actor: admin.id })).rows), ["e-2", "e-1"]);
    assert.deepEqual(ids((await run({ actor: `AUDIT-OTHER-${tag}@verify.invalid` })).rows), ["e-3"], "actor by e-mail, case-insensitive");
    assert.deepEqual(ids((await run({ actor: `nobody-${tag}@verify.invalid` })).rows), [], "unknown e-mail matches nothing");
    assert.deepEqual(ids((await run({ actor: "system" })).rows), ["e_4"]);
    assert.deepEqual(ids((await run({ from: "2020-01-10", to: "2020-01-10" })).rows), ["e-1"], "Baku day excludes 01:00 next day");
    assert.deepEqual(ids((await run({ from: "2020-01-11" })).rows), ["e_4", "e-3", "e-2"]);
    assert.deepEqual(ids((await run({ q: "50%" })).rows), ["e-1"], "free text on metadata, % literal");
    assert.deepEqual(ids((await run({ q: "e_" })).rows), ["e_4"], "underscore literal on entity id");
    const page1 = await run({}, { skip: 0, take: 2 });
    const page2 = await run({}, { skip: 2, take: 2 });
    assert.deepEqual([...ids(page1.rows), ...ids(page2.rows)], ["e_4", "e-3", "e-2", "e-1"], "stable pagination");
    assert.equal(page2.total, 4);
    assert.equal(page1.rows[0].actorEmail, null);
    assert.equal(page1.rows[1].actorRole, "VENDOR");

    // Export: filtered, capped, injection-safe, redacted, and audited.
    const { filters } = parseAuditLogFilters({ entityType, action: "VERIFY_A" });
    const exported = await exportAuditLogCsv(prisma, admin.id, filters);
    assert.equal(exported.rowCount, 3);
    assert.equal(exported.truncated, false);
    assert.equal(exported.csv.charCodeAt(0), 0xfeff);
    assert.doesNotMatch(exported.csv, /203\.0\.113\.9/, "IP in metadata is redacted");
    assert.doesNotMatch(exported.csv, /verify\.invalid/, "no actor e-mail in CSV");
    const capped = await exportAuditLogCsv(prisma, admin.id, parseAuditLogFilters({ entityType }).filters, 2);
    assert.equal(capped.rowCount, 2);
    assert.equal(capped.truncated, true);
    const all = await exportAuditLogCsv(prisma, admin.id, parseAuditLogFilters({ entityType }).filters);
    // The summary cell starts with "{", so Excel cannot evaluate it and no prefix is needed.
    assert.match(all.csv, /,"\{""note"":""=HYPERLINK\(1\)""\}"\r\n/);
    const entries = await prisma.auditLog.findMany({ where: { actorId: admin.id, action: "AUDIT_EXPORT" }, orderBy: { createdAt: "asc" } });
    assert.equal(entries.length, 3);
    assert.deepEqual(entries[0].metadata, { filters: { action: "VERIFY_A", entityType }, rowCount: 3, truncated: false, maxRows: 10_000 });
    assert.equal((entries[1].metadata as { truncated: boolean }).truncated, true);

    // System status: every card loads against real PostgreSQL (read-only transaction + statement timeout).
    for (const card of SYSTEM_STATUS_CARDS) {
      const result = await loadSystemStatusCard(card, { refresh: true });
      assert.ok(result.data, card);
    }
    const database = (await loadSystemStatusCard("database")).data as { reachable: boolean; postgresMajor: number | null; appliedMigrations: number };
    assert.equal(database.reachable, true);
    assert.ok((database.postgresMajor ?? 0) >= 12);
    assert.ok(database.appliedMigrations > 0);
  } finally {
    await prisma.auditLog.deleteMany({ where: { entityType } }).catch(() => undefined);
    if (userIds.length) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds }, action: "AUDIT_EXPORT" } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
    await prisma.$disconnect();
    const { prisma: shared } = await import("../lib/prisma").catch(() => ({ prisma: null }));
    await shared?.$disconnect().catch(() => undefined);
  }
});
