/**
 * Settings engine against the isolated verification PostgreSQL cluster.
 *
 * Safety: uses ONLY BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL and refuses unless the host is loopback, the port is
 * exactly 5433 and the database name contains "verify". Optional BAGATI_VERIFY_SCHEMA selects a scratch schema.
 * Never applies migrations. Rows it creates are removed in `finally`. Skips (NOT VERIFIED) when the cluster or
 * the SiteSetting table is missing.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const KEY = "commission.defaultRate";

function guardedVerifyUrl(): { url: string } | { refuse: string } | { skip: string } {
  const raw = process.env.BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL;
  if (!raw) return { skip: "BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL is not set" };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { refuse: "the verify URL is not a valid URL" }; }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return { refuse: "verify database host must be loopback" };
  if (parsed.port !== "5433") return { refuse: "verify database port must be exactly 5433" };
  if (!database.includes("verify")) return { refuse: "verify database name must contain \"verify\"" };
  const schema = process.env.BAGATI_VERIFY_SCHEMA;
  if (schema) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA is not a plain schema name" };
    parsed.searchParams.set("schema", schema);
  }
  return { url: parsed.toString() };
}

test("settings engine on the verify database: versions, revisions, audit, reset, rollback, conflicts", { timeout: 120_000 }, async (t) => {
  const guard = guardedVerifyUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = randomUUID().replace(/-/g, "").slice(0, 10);
  const userIds: string[] = [];
  try {
    let where: Array<{ db: string; port: number }>;
    try { where = await prisma.$queryRaw`SELECT current_database() AS db, inet_server_port() AS port`; }
    catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    assert.ok(where[0]?.db.includes("verify"));
    assert.equal(Number(where[0]?.port), 5433);
    const table = await prisma.$queryRaw<Array<{ t: string | null }>>`SELECT to_regclass('"SiteSetting"')::text AS t`;
    if (!table[0]?.t) return t.skip("NOT VERIFIED: SiteSetting table missing (migration 20261114010000 not applied in this schema)");
    if (await prisma.siteSetting.count({ where: { key: KEY } })) return t.skip(`NOT VERIFIED: ${KEY} already has a row in this schema; refusing to change it`);

    const write = await import("../lib/settings/write");
    const { readSettingInTransaction } = await import("../lib/settings/read");
    const code = async (promise: Promise<unknown>) => {
      try { await promise; return "OK"; } catch (error) { if (error instanceof write.SettingError) return error.code; throw error; }
    };
    const admin = await prisma.user.create({ data: { email: `settings-admin-${tag}@verify.invalid`, passwordHash: "x", role: "ADMIN" } });
    userIds.push(admin.id);
    const sensitive = { actorId: admin.id, confirm: true, reason: "Sahibkarın qərarı ilə sınaq" };

    await t.test("empty table: the default applies (null = no default commission)", async () => {
      assert.equal(await prisma.$transaction((tx) => readSettingInTransaction(tx, KEY)), null);
    });

    await t.test("sensitive checks run before any database change", async () => {
      assert.equal(await code(write.updateSetting(prisma, { key: KEY, expectedVersion: 0, actorId: admin.id, input: "10" })), "CONFIRM_REQUIRED");
      assert.equal(await code(write.updateSetting(prisma, { key: KEY, expectedVersion: 0, actorId: admin.id, confirm: true, reason: "qısa", input: "10" })), "REASON_REQUIRED");
      assert.equal(await code(write.updateSetting(prisma, { ...sensitive, key: KEY, expectedVersion: 0, input: "31" })), "INVALID");
      assert.equal(await prisma.siteSetting.count({ where: { key: KEY } }), 0);
      assert.equal(await prisma.siteSettingRevision.count({ where: { key: KEY } }), 0);
    });

    let firstRevision = "";
    await t.test("first write creates version 1, a revision with the previous value and an audit entry old -> new", async () => {
      const result = await write.updateSetting(prisma, { ...sensitive, key: KEY, expectedVersion: 0, input: "10" });
      firstRevision = result.revisionId;
      assert.equal(result.version, 1);
      const row = await prisma.siteSetting.findUniqueOrThrow({ where: { key: KEY } });
      assert.equal(row.value, "0.1000");
      assert.equal(row.updatedById, admin.id);
      const revision = await prisma.siteSettingRevision.findUniqueOrThrow({ where: { id: result.revisionId } });
      assert.deepEqual([revision.version, revision.value, revision.previousValue, revision.action, revision.reason], [1, "0.1000", null, "UPDATE", "Sahibkarın qərarı ilə sınaq"]);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "SITE_SETTING_UPDATE", entityId: KEY, actorId: admin.id } });
      const metadata = audit.metadata as Record<string, unknown>;
      assert.equal(metadata.from, null);
      assert.equal(metadata.to, "0.1000");
      assert.equal(metadata.fromDisplay, "Təyin edilməyib");
      assert.equal(metadata.toDisplay, "10%");
      assert.equal(metadata.sensitive, true);
      assert.equal(await prisma.$transaction((tx) => readSettingInTransaction(tx, KEY)), "0.1000");
    });

    await t.test("stale version -> VERSION_CONFLICT; same value -> NO_CHANGE; concurrent writers: one wins", async () => {
      assert.equal(await code(write.updateSetting(prisma, { ...sensitive, key: KEY, expectedVersion: 0, input: "12" })), "VERSION_CONFLICT");
      assert.equal(await code(write.updateSetting(prisma, { ...sensitive, key: KEY, expectedVersion: 1, input: "10" })), "NO_CHANGE");
      const results = await Promise.all(["12", "15"].map((input) => code(write.updateSetting(prisma, { ...sensitive, key: KEY, expectedVersion: 1, input }))));
      assert.deepEqual(results.sort(), ["OK", "VERSION_CONFLICT"]);
      assert.equal((await prisma.siteSetting.findUniqueOrThrow({ where: { key: KEY } })).version, 2);
    });

    await t.test("reset and rollback are new versions; history is never rewritten", async () => {
      const reset = await write.resetSetting(prisma, { ...sensitive, key: KEY, expectedVersion: 2 });
      assert.equal(reset.version, 3);
      assert.equal((await prisma.siteSetting.findUniqueOrThrow({ where: { key: KEY } })).value, null, "NULL = code default");
      assert.equal(await prisma.$transaction((tx) => readSettingInTransaction(tx, KEY)), null);
      assert.equal(await code(write.resetSetting(prisma, { ...sensitive, key: KEY, expectedVersion: 3 })), "NO_CHANGE");
      const rollback = await write.rollbackSetting(prisma, { ...sensitive, key: KEY, expectedVersion: 3, revisionId: firstRevision });
      assert.equal(rollback.version, 4);
      assert.equal((await prisma.siteSetting.findUniqueOrThrow({ where: { key: KEY } })).value, "0.1000");
      const history = await prisma.siteSettingRevision.findMany({ where: { key: KEY }, orderBy: { version: "asc" }, select: { version: true, action: true, value: true } });
      assert.deepEqual(history.map((row) => row.action), ["UPDATE", "UPDATE", "RESET", "ROLLBACK"]);
      assert.deepEqual(history.map((row) => row.version), [1, 2, 3, 4]);
      assert.equal(await code(write.rollbackSetting(prisma, { ...sensitive, key: KEY, expectedVersion: 4, revisionId: "missing" })), "REVISION_NOT_FOUND");
      assert.equal(await prisma.auditLog.count({ where: { action: "SITE_SETTING_UPDATE", entityId: KEY, actorId: admin.id } }), 4);
    });

    await t.test("an invalid stored value is ignored on read (default applies)", async () => {
      await prisma.$executeRaw`UPDATE "SiteSetting" SET "value" = '0.95'::jsonb WHERE "key" = ${KEY}`;
      assert.equal(await prisma.$transaction((tx) => readSettingInTransaction(tx, KEY)), null);
    });
  } finally {
    await prisma.siteSettingRevision.deleteMany({ where: { key: KEY, changedById: { in: userIds } } });
    await prisma.siteSetting.deleteMany({ where: { key: KEY } });
    if (userIds.length) {
      await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  }
});
