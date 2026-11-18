/**
 * LegalAcceptance against the isolated verification PostgreSQL cluster.
 *
 * Safety: uses ONLY BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL and refuses unless the host is loopback, the port is
 * exactly 5433 and the database name contains "verify". BAGATI_VERIFY_SCHEMA must name a cat_* scratch schema (a
 * schema where all migrations incl. 20261118020000_legal_acceptance are applied); without it the test skips.
 * Never reads .env, never connects to 5432, never applies migrations. Fixture rows are tagged and deleted in
 * `finally`. Skips (NOT VERIFIED) when the cluster or the LegalAcceptance table is missing.
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
  const schema = process.env.BAGATI_VERIFY_SCHEMA;
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (a migrated cat_* scratch schema is required)" };
  if (!/^cat_[a-z0-9_]{1,58}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be a plain cat_* schema name" };
  parsed.searchParams.set("schema", schema);
  return { url: parsed.toString() };
}

test("legal acceptance: record, idempotent repeat, new version, concurrency, Cascade on user, SetNull on application", { timeout: 120_000 }, async (t) => {
  const guard = guardedVerifyUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;

  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = randomUUID().replace(/-/g, "").slice(0, 10);
  const userIds: string[] = [];
  try {
    let where: Array<{ db: string; port: number; schema: string }>;
    try { where = await prisma.$queryRaw`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`; }
    catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    assert.ok(where[0]?.db.includes("verify"));
    assert.equal(Number(where[0]?.port), 5433);
    assert.ok(where[0]?.schema.startsWith("cat_"), "running in a cat_* scratch schema");
    const table = await prisma.$queryRaw<Array<{ t: string | null }>>`SELECT to_regclass('"LegalAcceptance"')::text AS t`;
    if (!table[0]?.t) return t.skip("NOT VERIFIED: LegalAcceptance table missing (migration 20261118020000 not applied in this schema)");

    const { recordAcceptance, hasAcceptedCurrent, LEGAL_TERMS_ACCEPTED } = await import("../lib/legal-acceptance");
    const { LEGAL_VERSIONS } = await import("../lib/legal-versions");
    const user = async (label: string) => {
      const created = await prisma.user.create({ data: { email: `la-${label}-${tag}@verify.invalid`, passwordHash: "x", role: "CUSTOMER", emailVerifiedAt: new Date() } });
      userIds.push(created.id);
      return created;
    };
    const audits = (actorId: string) => prisma.auditLog.findMany({ where: { actorId, action: LEGAL_TERMS_ACCEPTED }, orderBy: { createdAt: "asc" } });

    await t.test("first acceptance creates the row and one audit row; a repeat creates nothing", async () => {
      const u = await user("first");
      assert.equal(await hasAcceptedCurrent(prisma, u.id, "CUSTOMER_TERMS"), false);
      const first = await prisma.$transaction((tx) => recordAcceptance(tx, { userId: u.id, document: "CUSTOMER_TERMS", source: "REGISTER_EMAIL" }));
      assert.deepEqual(first, { created: true, version: LEGAL_VERSIONS.CUSTOMER_TERMS });
      const rows = await prisma.legalAcceptance.findMany({ where: { userId: u.id } });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].version, "2026-11-17");
      assert.equal(rows[0].source, "REGISTER_EMAIL");
      assert.ok(Math.abs(rows[0].acceptedAt.getTime() - Date.now()) < 60_000, "acceptedAt is now");
      const log = await audits(u.id);
      assert.equal(log.length, 1);
      assert.equal(log[0].entityType, "LegalAcceptance");
      assert.equal(log[0].entityId, rows[0].id);
      assert.deepEqual(log[0].metadata, { document: "CUSTOMER_TERMS", version: "2026-11-17", source: "REGISTER_EMAIL" });
      assert.equal(await hasAcceptedCurrent(prisma, u.id, "CUSTOMER_TERMS"), true);

      const again = await prisma.$transaction((tx) => recordAcceptance(tx, { userId: u.id, document: "CUSTOMER_TERMS", source: "CHECKOUT" }));
      assert.deepEqual(again, { created: false, version: "2026-11-17" });
      assert.equal(await prisma.legalAcceptance.count({ where: { userId: u.id } }), 1);
      assert.equal((await audits(u.id)).length, 1, "no second audit row");
      // The database itself refuses a duplicate, even bypassing the helper.
      await assert.rejects(prisma.legalAcceptance.create({ data: { userId: u.id, document: "CUSTOMER_TERMS", version: "2026-11-17", source: "CHECKOUT" } }), { code: "P2002" });
    });

    await t.test("an older version does not count; accepting the current one adds a new row next to it", async () => {
      const u = await user("version");
      await prisma.legalAcceptance.create({ data: { userId: u.id, document: "SELLER_TERMS", version: "2026-01-01", source: "SELLER_PANEL" } });
      assert.equal(await hasAcceptedCurrent(prisma, u.id, "SELLER_TERMS"), false);
      const result = await prisma.$transaction((tx) => recordAcceptance(tx, { userId: u.id, document: "SELLER_TERMS", source: "SELLER_PANEL" }));
      assert.equal(result.created, true);
      const versions = (await prisma.legalAcceptance.findMany({ where: { userId: u.id }, orderBy: { version: "asc" } })).map((r) => r.version);
      assert.deepEqual(versions, ["2026-01-01", LEGAL_VERSIONS.SELLER_TERMS]);
      assert.equal(await hasAcceptedCurrent(prisma, u.id, "SELLER_TERMS"), true);
    });

    await t.test("two concurrent acceptances of the same version: one row, one audit row, no error", async () => {
      const u = await user("race");
      const results = await Promise.all([1, 2, 3].map(() => prisma.$transaction((tx) => recordAcceptance(tx, { userId: u.id, document: "CUSTOMER_TERMS", source: "CHECKOUT" }))));
      assert.equal(results.filter((r) => r.created).length, 1);
      assert.equal(await prisma.legalAcceptance.count({ where: { userId: u.id } }), 1);
      assert.equal((await audits(u.id)).length, 1);
    });

    await t.test("a failed transaction leaves neither the row nor the audit row", async () => {
      const u = await user("rollback");
      await assert.rejects(prisma.$transaction(async (tx) => {
        await recordAcceptance(tx, { userId: u.id, document: "CUSTOMER_TERMS", source: "REGISTER_EMAIL" });
        throw new Error("action failed after the acceptance");
      }), /action failed/);
      assert.equal(await prisma.legalAcceptance.count({ where: { userId: u.id } }), 0);
      assert.equal((await audits(u.id)).length, 0);
    });

    await t.test("deleting the seller application keeps the acceptance with vendorApplicationId = NULL", async () => {
      const u = await user("application");
      const application = await prisma.vendorApplication.create({
        data: { userId: u.id, status: "WITHDRAWN", source: "SELF", displayName: "Fixture", sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: "Fixture", voen: "9000000012", voenNormalized: "9000000012", withdrawnAt: new Date() },
      });
      await prisma.$transaction((tx) => recordAcceptance(tx, { userId: u.id, document: "SELLER_TERMS", source: "SELLER_APPLICATION", vendorApplicationId: application.id }));
      assert.equal((await prisma.legalAcceptance.findFirstOrThrow({ where: { userId: u.id } })).vendorApplicationId, application.id);
      await prisma.vendorApplication.delete({ where: { id: application.id } });
      const row = await prisma.legalAcceptance.findFirstOrThrow({ where: { userId: u.id } });
      assert.equal(row.vendorApplicationId, null);
      assert.equal(row.document, "SELLER_TERMS");
    });

    await t.test("deleting the user deletes their acceptance rows (Cascade); the audit rows stay with actorId NULL", async () => {
      const u = await user("cascade");
      await prisma.$transaction(async (tx) => {
        await recordAcceptance(tx, { userId: u.id, document: "CUSTOMER_TERMS", source: "REGISTER_GOOGLE" });
        await recordAcceptance(tx, { userId: u.id, document: "SELLER_TERMS", source: "SELLER_PANEL" });
      });
      const ids = (await prisma.legalAcceptance.findMany({ where: { userId: u.id }, select: { id: true } })).map((r) => r.id);
      assert.equal(ids.length, 2);
      await prisma.user.delete({ where: { id: u.id } });
      userIds.splice(userIds.indexOf(u.id), 1);
      assert.equal(await prisma.legalAcceptance.count({ where: { id: { in: ids } } }), 0);
      const orphanAudits = await prisma.auditLog.findMany({ where: { action: LEGAL_TERMS_ACCEPTED, entityId: { in: ids } } });
      assert.equal(orphanAudits.length, 2);
      assert.ok(orphanAudits.every((a) => a.actorId === null));
      await prisma.auditLog.deleteMany({ where: { id: { in: orphanAudits.map((a) => a.id) } } });
    });
  } finally {
    if (userIds.length) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds }, action: "LEGAL_TERMS_ACCEPTED" } }).catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
});
