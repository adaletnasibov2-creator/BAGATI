/**
 * In-process email worker against real PostgreSQL: the session advisory lock across two "processes" (two
 * single-connection clients), the real outbox batch with a FAKE transport (nothing is ever sent), the database
 * heartbeat, and the 24 h staleness rule.
 *
 * Safety: uses only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, database name containing "verify")
 * and REQUIRES BAGATI_VERIFY_SCHEMA = a cat_* scratch schema with all migrations including
 * 20261118010000_email_worker_heartbeat. It never migrates, never reads .env, never connects to 5432. Its own rows
 * (random tag) are deleted at the end. The advisory lock key is a test key, not the production key.
 *
 *   BAGATI_VERIFY_SCHEMA=cat_emailworker_it npx tsx --test scripts/email-worker.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (needs a migrated cat_* scratch schema)" };
  if (!/^cat_[a-z0-9_]{1,40}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be a cat_* scratch schema" };
  parsed.searchParams.set("schema", schema);
  return { url: parsed.toString() };
}

test("in-process email worker on PostgreSQL", { timeout: 120_000 }, async (t) => {
  const guard = guardedScratchUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;
  process.env.SESSION_SECRET ??= "bagati-isolated-email-worker-integration-secret";
  delete process.env.EMAIL_ENCRYPTION_KEY;
  delete process.env.EMAIL_WORKER_ENABLED;

  const { singleConnectionDatabaseUrl, createAdvisoryOutboxLock, drainEmailOutboxNow } = await import("../lib/email-worker-runtime");
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  // Two "processes": each has its own one-connection lock client, like two app instances.
  const sessionA = new PrismaClient({ datasourceUrl: singleConnectionDatabaseUrl(guard.url) });
  const sessionB = new PrismaClient({ datasourceUrl: singleConnectionDatabaseUrl(guard.url) });
  const tag = `ew${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const TEST_LOCK_KEY = String(900_000_000_000 + Math.floor(Math.random() * 1_000_000));
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const [where] = await prisma.$queryRaw<{ db: string; port: number; schema: string }[]>`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`;
    assert.ok(where.db.includes("verify") && Number(where.port) === 5433 && where.schema.startsWith("cat_"));
    const migrated = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'EmailWorkerHeartbeat'`;
    if (!migrated[0]?.n) return t.skip("NOT VERIFIED: scratch schema lacks the EmailWorkerHeartbeat table (this test never migrates)");

    const { enqueueEmail } = await import("../lib/email-outbox");
    const { processEmailOutboxBatch } = await import("../lib/email-outbox-worker");
    const { createEmailWorkerLoop } = await import("../lib/email-worker-loop");
    const { writeEmailWorkerHeartbeatToDatabase, readEmailWorkerHeartbeatFromDatabase } = await import("../lib/email-worker-heartbeat-store");

    await prisma.emailOutbox.deleteMany({ where: { recipient: { endsWith: `@${tag}.verify.invalid` } } });
    // availableAt is stored with millisecond precision and PostgreSQL rounds it, so a row queued in the same millisecond
    // as the batch can sit just after the batch's "now" and wait for the next tick. A few ms keeps the test deterministic.
    const settleAvailableAt = () => new Promise((resolve) => setTimeout(resolve, 5));

    await t.test("session advisory lock: one holder at a time across sessions; released by unlock and by disconnect", async () => {
      const lockA = createAdvisoryOutboxLock(sessionA, TEST_LOCK_KEY);
      const lockB = createAdvisoryOutboxLock(sessionB, TEST_LOCK_KEY);
      assert.equal(await lockA.tryAcquire(), true);
      assert.equal(await lockB.tryAcquire(), false, "B refused while A holds it");
      await lockA.release();
      assert.equal(await lockB.tryAcquire(), true, "B gets it after A released");
      await lockB.release();
      // A crash: the connection goes away while holding the lock; PostgreSQL frees it.
      const crashing = new PrismaClient({ datasourceUrl: singleConnectionDatabaseUrl(guard.url) });
      assert.equal(await createAdvisoryOutboxLock(crashing, TEST_LOCK_KEY).tryAcquire(), true);
      assert.equal(await lockB.tryAcquire(), false);
      await crashing.$disconnect();
      let freed = false;
      for (let i = 0; i < 50 && !freed; i++) { freed = await lockB.tryAcquire(); if (!freed) await new Promise((r) => setTimeout(r, 100)); }
      assert.equal(freed, true, "lock freed when the holder's connection closed");
      await lockB.release();
    });

    await t.test("two loops tick together: exactly one runs the batch; every row is sent exactly once (fake transport)", async () => {
      for (let i = 0; i < 6; i++) {
        await enqueueEmail(prisma, { eventKey: `${tag}:welcome:${i}`, recipient: `c${i}@${tag}.verify.invalid`, template: "WELCOME_CUSTOMER", payload: { name: `Test ${i}` } });
      }
      await settleAvailableAt();
      const delivered: string[] = [];
      let releaseSend!: () => void;
      const sendGate = new Promise<void>((r) => { releaseSend = r; });
      const fakeTransport = async (_template: string, _payload: unknown, recipient: string) => {
        await sendGate;
        delivered.push(recipient);
      };
      const runBatch = () => processEmailOutboxBatch(25, { prisma, assertSmtpConfigured: () => undefined, sendTransactionalEmail: fakeTransport as never });
      const loopOn = (session: PrismaClient) => createEmailWorkerLoop({
        lock: createAdvisoryOutboxLock(session, TEST_LOCK_KEY),
        runBatch,
        heartbeat: { write: (beat) => writeEmailWorkerHeartbeatToDatabase(session, beat) },
        logger: { info: () => undefined, error: () => undefined },
        setTimer: () => undefined,
        clearTimer: () => undefined,
      });
      const loopA = loopOn(sessionA);
      const loopB = loopOn(sessionB);
      loopA.start(); // the fake setTimer schedules nothing; ticks are driven by hand below
      loopB.start();
      const first = loopA.tick();
      // Wait until A holds the lock and is inside the batch (heartbeat lastPollStartedAt written).
      for (let i = 0; i < 50; i++) {
        const beat = await readEmailWorkerHeartbeatFromDatabase(prisma);
        if (beat?.lastPollStartedAt && !beat.lastPollCompletedAt) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal(await loopB.tick(), "standby", "B is on standby while A runs");
      assert.deepEqual(await drainEmailOutboxNow(createAdvisoryOutboxLock(sessionB, TEST_LOCK_KEY), runBatch), { status: "busy" }, "the admin button is refused too");
      releaseSend();
      assert.equal(await first, "ran");
      const mine = await prisma.emailOutbox.findMany({ where: { recipient: { endsWith: `@${tag}.verify.invalid` } }, select: { status: true, attempts: true, recipient: true } });
      assert.equal(mine.length, 6);
      assert.ok(mine.every((row) => row.status === "SENT" && row.attempts === 1));
      assert.equal(delivered.length, 6);
      assert.equal(new Set(delivered).size, 6, "no duplicates");
      // B now runs, finds nothing left, sends nothing.
      assert.equal(await loopB.tick(), "ran");
      assert.equal(delivered.length, 6);
      const beat = await readEmailWorkerHeartbeatFromDatabase(prisma);
      assert.equal(beat?.lastPollProcessed, 0, "B's (empty) poll is the latest heartbeat");
      assert.equal(beat?.lastPollErrorCode, null);
      await loopA.stop();
      await loopB.stop();
      const stopped = await readEmailWorkerHeartbeatFromDatabase(prisma);
      assert.ok(stopped?.stoppedAt, "the last stopper records stoppedAt");
    });

    await t.test("a failing transport does not crash the loop; the heartbeat records a safe code", async () => {
      await enqueueEmail(prisma, { eventKey: `${tag}:fail`, recipient: `fail@${tag}.verify.invalid`, template: "WELCOME_CUSTOMER", payload: { name: "X" } });
      const loop = createEmailWorkerLoop({
        lock: createAdvisoryOutboxLock(sessionA, TEST_LOCK_KEY),
        runBatch: () => processEmailOutboxBatch(25, { prisma, assertSmtpConfigured: () => { throw Object.assign(new Error("SMTP missing"), { name: "SmtpConfigurationError" }); }, sendTransactionalEmail: async () => { throw new Error("unreachable"); } }),
        heartbeat: { write: (beat) => writeEmailWorkerHeartbeatToDatabase(sessionA, beat) },
        logger: { info: () => undefined, error: () => undefined },
        setTimer: () => undefined,
        clearTimer: () => undefined,
      });
      assert.equal(await loop.tick(), "ran");
      const beat = await readEmailWorkerHeartbeatFromDatabase(prisma);
      assert.equal(beat?.lastPollErrorCode, "SMTP_NOT_CONFIGURED");
      const row = await prisma.emailOutbox.findFirstOrThrow({ where: { recipient: `fail@${tag}.verify.invalid` } });
      assert.equal(row.status, "PENDING", "SMTP missing never claims a row");
      assert.equal(row.attempts, 0);
      const probe = createAdvisoryOutboxLock(sessionB, TEST_LOCK_KEY);
      assert.equal(await probe.tryAcquire(), true, "lock released after the failure");
      await probe.release();
      await prisma.emailOutbox.deleteMany({ where: { recipient: `fail@${tag}.verify.invalid` } });
    });

    await t.test("staleness: a 25 h old MESSAGE_TO_STORE row is FAILED NOTIFICATION_STALE and never sent", async () => {
      const recipient = `stale@${tag}.verify.invalid`;
      await enqueueEmail(prisma, { eventKey: `${tag}:stale`, recipient, template: "MESSAGE_TO_STORE", payload: { storeName: "S", url: "https://shopbagati.com/x" } });
      await prisma.emailOutbox.updateMany({ where: { recipient }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
      await settleAvailableAt();
      const delivered: string[] = [];
      await processEmailOutboxBatch(25, { prisma, assertSmtpConfigured: () => undefined, sendTransactionalEmail: (async (_t: string, _p: unknown, to: string) => { delivered.push(to); }) as never });
      const row = await prisma.emailOutbox.findFirstOrThrow({ where: { recipient } });
      assert.equal(row.status, "FAILED");
      assert.equal(row.lastErrorCode, "NOTIFICATION_STALE");
      assert.equal(row.failureCategory, "MESSAGE_REJECTED");
      assert.equal(row.retrySafe, false);
      assert.deepEqual(delivered, []);
    });
  } finally {
    await prisma.emailOutbox.deleteMany({ where: { recipient: { endsWith: `@${tag}.verify.invalid` } } }).catch(() => undefined);
    await prisma.emailWorkerHeartbeat.deleteMany({}).catch(() => undefined);
    await Promise.all([prisma.$disconnect(), sessionA.$disconnect(), sessionB.$disconnect()]);
  }
});
