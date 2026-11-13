/**
 * Security Center monitoring against the isolated verification PostgreSQL cluster, in a SCRATCH schema only.
 *
 * Safety: uses only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, database name containing "verify")
 * and REQUIRES BAGATI_VERIFY_SCHEMA starting with "sc_" (it empties the Security Center tables of that schema).
 * Never applies migrations. Skips (NOT VERIFIED) when the cluster or the tables are missing.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

function guardedScratchUrl(): { url: string } | { refuse: string } | { skip: string } {
  const raw = process.env.BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL;
  if (!raw) return { skip: "verify database URL is not set" };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { refuse: "the verify URL is not a valid URL" }; }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return { refuse: "verify database host must be loopback" };
  if (parsed.port !== "5433") return { refuse: "verify database port must be exactly 5433" };
  if (!database.includes("verify")) return { refuse: "verify database name must contain \"verify\"" };
  const schema = process.env.BAGATI_VERIFY_SCHEMA;
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (this test needs a dedicated sc_* scratch schema)" };
  if (!/^sc_[a-z0-9_]{1,40}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be an sc_* scratch schema" };
  parsed.searchParams.set("schema", schema);
  return { url: parsed.toString() };
}

test("security monitoring on a scratch schema: flush increments, rules with cooldown, roll-up, retention", { timeout: 120_000 }, async (t) => {
  const guard = guardedScratchUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const wipe = async () => {
    await prisma.securityIncidentNote.deleteMany({});
    await prisma.securityIncident.deleteMany({});
    await prisma.securityAlertRule.deleteMany({});
    await prisma.securityMinuteStat.deleteMany({});
    await prisma.securityHourStat.deleteMany({});
    await prisma.securityEvent.deleteMany({});
  };
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const table = await prisma.$queryRaw<Array<{ t: string | null }>>`SELECT to_regclass('"SecurityMinuteStat"')::text AS t`;
    if (!table[0]?.t) return t.skip("NOT VERIFIED: Security Center tables missing (migration 20261114020000 not applied in this schema)");
    await wipe();
    const { writeMinuteRows } = await import("../lib/security-monitoring/instance");
    const jobs = await import("../lib/security-monitoring/jobs");
    const now = new Date();
    const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const row = (patch: Record<string, number>) => ({ bucketStart: minute, routeGroup: "auth.login", requests: 0, status4xx: 0, status5xx: 0, authDenied: 0, notFound: 0, rateLimited: 0, loginFailures: 0, ipMismatches: 0, durationMsSum: 0, durationMsMax: 0, ...patch });

    await t.test("two processes flushing the same minute add up; max keeps the larger value", async () => {
      await writeMinuteRows([row({ requests: 10, status5xx: 12, durationMsSum: 100, durationMsMax: 40 })]);
      await writeMinuteRows([row({ requests: 5, status5xx: 13, durationMsSum: 50, durationMsMax: 25 })]);
      const stored = await prisma.securityMinuteStat.findUniqueOrThrow({ where: { bucketStart_routeGroup: { bucketStart: minute, routeGroup: "auth.login" } } });
      assert.deepEqual([stored.requests, stored.status5xx, Number(stored.durationMsSum), stored.durationMsMax], [15, 25, 150, 40]);
      assert.equal(stored.bucketStart.toISOString(), minute.toISOString(), "UTC minute, whatever the server TimeZone");
    });

    await t.test("a rule over its threshold opens one incident; cooldown and concurrent evaluators prevent duplicates", async () => {
      const opened = await jobs.evaluateAlertRules(prisma, now);
      assert.equal(opened.length, 1, "5xx spike: 25 >= 20");
      const incident = await prisma.securityIncident.findFirstOrThrow({ where: { ruleKey: "server_error_spike" }, include: { notes: true } });
      assert.equal(incident.status, "OPEN");
      assert.equal(incident.severity, "HIGH");
      assert.equal(incident.observedValue, 25);
      assert.equal(incident.notes.length, 1);
      const again = await Promise.all([jobs.evaluateAlertRules(prisma, new Date(now.getTime() + 1_000)), jobs.evaluateAlertRules(prisma, new Date(now.getTime() + 1_000))]);
      assert.deepEqual(again.map((ids) => ids.length), [0, 0], "inside the 15 minute cooldown");
      assert.equal(await prisma.securityIncident.count({ where: { ruleKey: "server_error_spike" } }), 1);
    });

    await t.test("an admin override (higher threshold or disabled) is respected", async () => {
      await prisma.securityIncident.deleteMany({});
      await prisma.securityAlertRule.create({ data: { key: "server_error_spike", enabled: true, threshold: 100, windowMinutes: 5, cooldownMinutes: 15 } });
      assert.equal((await jobs.evaluateAlertRules(prisma, now)).length, 0);
      await prisma.securityAlertRule.update({ where: { key: "server_error_spike" }, data: { threshold: 20, enabled: false } });
      assert.equal((await jobs.evaluateAlertRules(prisma, now)).length, 0);
    });

    await t.test("event-based rules: login failures and 2FA failures", async () => {
      await prisma.securityIncident.deleteMany({});
      await prisma.securityAlertRule.deleteMany({});
      await prisma.securityMinuteStat.deleteMany({});
      for (let index = 0; index < 5; index += 1) {
        await prisma.securityEvent.create({ data: { source: "APPLICATION", sourceEventId: `twofa-${index}`, occurredAt: new Date(now.getTime() - index * 1_000), path: "/api/admin/login/2fa", eventType: "LOGIN_FAILURE", severity: "MEDIUM", action: "DENIED" } });
      }
      const opened = await jobs.evaluateAlertRules(prisma, now);
      const rules = (await prisma.securityIncident.findMany({ where: { id: { in: opened } }, select: { ruleKey: true, severity: true } })).map((item) => `${item.ruleKey}:${item.severity}`);
      assert.deepEqual(rules, ["two_factor_failures:CRITICAL"], "5 2FA failures; 5 login failures is below the burst threshold of 30");
    });

    await t.test("hourly roll-up is recomputed, not added", async () => {
      await writeMinuteRows([row({ requests: 7, notFound: 3 })]);
      await jobs.rollupHours(prisma, now);
      await jobs.rollupHours(prisma, now);
      const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
      const stored = await prisma.securityHourStat.findUniqueOrThrow({ where: { bucketStart_routeGroup: { bucketStart: hour, routeGroup: "auth.login" } } });
      assert.equal(stored.requests, 7);
      assert.equal(stored.notFound, 3);
    });

    await t.test("retention: masks then clears raw IPs after 7 days; deletes minute stats after 14 and hourly after 90 days", async () => {
      const day = 24 * 60 * 60 * 1000;
      await prisma.securityEvent.create({ data: { source: "APPLICATION", sourceEventId: "old-ip", occurredAt: new Date(now.getTime() - 8 * day), sourceIp: "203.0.113.77", eventType: "LOGIN_FAILURE", severity: "MEDIUM", action: "DENIED" } });
      await prisma.securityEvent.create({ data: { source: "APPLICATION", sourceEventId: "new-ip", occurredAt: new Date(now.getTime() - day), sourceIp: "2001:db8:1:2::9", eventType: "LOGIN_FAILURE", severity: "MEDIUM", action: "DENIED" } });
      await writeMinuteRows([row({ requests: 1 }), { ...row({ requests: 1 }), bucketStart: new Date(minute.getTime() - 15 * day) }]);
      await prisma.securityHourStat.create({ data: { bucketStart: new Date(minute.getTime() - 91 * day), routeGroup: "auth.login", requests: 1 } });
      const first = await jobs.applyRetention(prisma, now);
      assert.equal(first.masked, 2);
      assert.equal(first.rawCleared, 1);
      assert.equal(first.minuteDeleted, 1);
      assert.equal(first.hourDeleted, 1);
      const old = await prisma.securityEvent.findFirstOrThrow({ where: { sourceEventId: "old-ip" } });
      assert.deepEqual([old.sourceIp, old.sourceIpMasked], [null, "203.0.*.*"]);
      const recent = await prisma.securityEvent.findFirstOrThrow({ where: { sourceEventId: "new-ip" } });
      assert.deepEqual([recent.sourceIp, recent.sourceIpMasked], ["2001:db8:1:2::9", "2001:db8:*:*"]);
      assert.deepEqual(await jobs.applyRetention(prisma, now), { masked: 0, rawCleared: 0, minuteDeleted: 0, hourDeleted: 0 }, "idempotent");
    });

    await t.test("maintenance runs in one process at a time (advisory try-lock) and the throttled entry point never throws", async () => {
      const results = await Promise.all([jobs.runMaintenance(prisma, now), jobs.runMaintenance(prisma, now)]);
      assert.ok(results.includes(true));
      jobs.resetMonitoringJobThrottle();
      const ran = await jobs.maybeRunMonitoringJobs(now.getTime(), prisma);
      assert.deepEqual(ran, { rules: true, maintenance: true });
      assert.deepEqual(await jobs.maybeRunMonitoringJobs(now.getTime() + 1_000, prisma), { rules: false, maintenance: false }, "throttled");
    });
  } finally {
    await wipe().catch(() => undefined);
    await prisma.$disconnect();
  }
});
