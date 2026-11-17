/**
 * In-process email worker: flag, loop, lock, failure isolation, staleness, admin buttons, status card heartbeat.
 * No database, no SMTP, no real timers: every dependency is a fake. Nothing is ever sent.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  createEmailWorkerLoop,
  emailWorkerEnabled,
  EMAIL_WORKER_FIRST_TICK_MS,
  EMAIL_WORKER_INTERVAL_MS,
  shouldStartInProcessEmailWorker,
  type OutboxLock,
} from "@/lib/email-worker-loop";
import type { EmailWorkerHeartbeat } from "@/lib/email-worker-monitoring";
import { encryptEmailSecret } from "@/lib/email-outbox";
import { AGE_LIMITED_TEMPLATES, isNotificationTooOld, NOTIFICATION_MAX_AGE_MS, processEmailOutboxBatch } from "@/lib/email-outbox-worker";
import { diagnoseEmailDeliveryFailure } from "@/lib/email-outbox-core";
import { handleAdminOutboxDrain, handleAdminTestEmail, type AdminEmailActionDependencies } from "@/lib/admin-email-actions";
import { newestEmailWorkerHeartbeat, readEmailWorkerHeartbeatFromDatabase } from "@/lib/email-worker-heartbeat-store";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/** An in-memory lock shared by several fake "processes" (like one advisory lock key). */
function sharedLock() {
  let holder: string | null = null;
  const forProcess = (name: string): OutboxLock => ({
    async tryAcquire() { if (holder !== null) return false; holder = name; return true; },
    async release() { if (holder === name) holder = null; },
  });
  return { forProcess, get holder() { return holder; } };
}

function fakeTimers() {
  const pending: Array<{ id: number; callback: () => void; ms: number }> = [];
  let next = 1;
  return {
    pending,
    setTimer: (callback: () => void, ms: number) => { const id = next++; pending.push({ id, callback, ms }); return id; },
    clearTimer: (handle: unknown) => { const index = pending.findIndex((timer) => timer.id === handle); if (index !== -1) pending.splice(index, 1); },
    async fire() {
      const timer = pending.shift();
      assert.ok(timer, "a timer is scheduled");
      timer.callback();
      // Let the tick and the re-schedule run.
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
      return timer.ms;
    },
  };
}

function capturingLogger() {
  const lines: string[] = [];
  return { lines, info: (m: string) => lines.push(`info ${m}`), error: (m: string) => lines.push(`error ${m}`) };
}

// ---------------------------------------------------------------------------------------------------------------
// 1. Flag

test("flag: only EMAIL_WORKER_ENABLED=true in the Node.js runtime starts the worker; build and Edge never do", () => {
  assert.equal(emailWorkerEnabled({}), false);
  for (const value of ["1", "TRUE", "yes", "on", " true", "false", ""]) assert.equal(emailWorkerEnabled({ EMAIL_WORKER_ENABLED: value }), false, value);
  assert.equal(emailWorkerEnabled({ EMAIL_WORKER_ENABLED: "true" }), true);
  assert.equal(shouldStartInProcessEmailWorker({ NEXT_RUNTIME: "nodejs" }), false, "default off");
  assert.equal(shouldStartInProcessEmailWorker({ NEXT_RUNTIME: "edge", EMAIL_WORKER_ENABLED: "true" }), false);
  assert.equal(shouldStartInProcessEmailWorker({ EMAIL_WORKER_ENABLED: "true" }), false, "no runtime (scripts, tests)");
  assert.equal(shouldStartInProcessEmailWorker({ NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-build", EMAIL_WORKER_ENABLED: "true" }), false);
  assert.equal(shouldStartInProcessEmailWorker({ NEXT_RUNTIME: "nodejs", EMAIL_WORKER_ENABLED: "true" }), true);
});

test("flag off: register() creates no timer, no loop and loads no worker module", async () => {
  const saved = { runtime: process.env.NEXT_RUNTIME, flag: process.env.EMAIL_WORKER_ENABLED };
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  let timers = 0;
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => { timers++; return realSetTimeout(...args); }) as typeof setTimeout;
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => { timers++; return realSetInterval(...args); }) as typeof setInterval;
  try {
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.EMAIL_WORKER_ENABLED;
    const { register } = await import("../instrumentation");
    await register();
    process.env.EMAIL_WORKER_ENABLED = "1";
    await register();
    assert.equal(timers, 0);
    assert.equal((globalThis as { __bagatiEmailWorkerRuntime?: unknown }).__bagatiEmailWorkerRuntime, undefined);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.setInterval = realSetInterval;
    if (saved.runtime === undefined) delete process.env.NEXT_RUNTIME; else process.env.NEXT_RUNTIME = saved.runtime;
    if (saved.flag === undefined) delete process.env.EMAIL_WORKER_ENABLED; else process.env.EMAIL_WORKER_ENABLED = saved.flag;
  }
});

test("flag off: startInProcessEmailWorker returns null without touching the database", async () => {
  const { startInProcessEmailWorker } = await import("@/lib/email-worker-runtime");
  assert.equal(startInProcessEmailWorker({ NEXT_RUNTIME: "nodejs" }), null);
  assert.equal(startInProcessEmailWorker({ NEXT_RUNTIME: "nodejs", EMAIL_WORKER_ENABLED: "false" }), null);
  assert.equal((globalThis as { __bagatiEmailWorkerRuntime?: unknown }).__bagatiEmailWorkerRuntime, undefined);
});

test("instrumentation: nested NEXT_RUNTIME check (keeps the worker out of Edge), flag before the import", () => {
  const source = read("instrumentation.ts");
  assert.match(source, /if \(process\.env\.NEXT_RUNTIME === "nodejs"\) \{\s*if \(process\.env\.EMAIL_WORKER_ENABLED !== "true"[^\n]*return;\s*try \{\s*const \{ startInProcessEmailWorker \} = await import\("\.\/lib\/email-worker-runtime"\);/);
  assert.doesNotMatch(source, /^import /m, "no static import");
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Loop

test("loop: first tick after 5 s, then every 30 s; runs a batch under the lock and writes the heartbeat", async () => {
  const timers = fakeTimers();
  const lock = sharedLock();
  const beats: EmailWorkerHeartbeat[] = [];
  let batches = 0;
  const loop = createEmailWorkerLoop({
    lock: lock.forProcess("a"),
    runBatch: async () => { batches++; assert.equal(lock.holder, "a", "batch runs while holding the lock"); return { processed: 2, sent: 2, failed: 0 }; },
    heartbeat: { write: async (beat) => { beats.push(beat); } },
    logger: capturingLogger(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  loop.start();
  loop.start(); // idempotent
  assert.equal(timers.pending.length, 1);
  assert.equal(await timers.fire(), EMAIL_WORKER_FIRST_TICK_MS);
  assert.equal(batches, 1);
  assert.equal(lock.holder, null, "lock released after the batch");
  assert.equal(timers.pending.length, 1);
  assert.equal(timers.pending[0].ms, EMAIL_WORKER_INTERVAL_MS);
  assert.equal(EMAIL_WORKER_INTERVAL_MS, 30_000);
  const last = beats.at(-1)!;
  assert.equal(last.lastPollSent, 2);
  assert.equal(last.lastPollErrorCode, null);
  assert.ok(last.lastSuccessfulPollAt);
  await timers.fire();
  assert.equal(batches, 2);
  await loop.stop();
});

test("advisory lock: two loops tick at the same time, exactly one runs the batch, the other stays on standby", async () => {
  const lock = sharedLock();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const ran: string[] = [];
  const make = (name: string) => createEmailWorkerLoop({
    lock: lock.forProcess(name),
    runBatch: async () => { ran.push(name); await gate; return { processed: 1, sent: 1, failed: 0 }; },
    heartbeat: { write: async () => undefined },
    logger: capturingLogger(),
    setTimer: () => undefined,
    clearTimer: () => undefined,
  });
  const a = make("a");
  const b = make("b");
  const first = a.tick();
  await new Promise((r) => setImmediate(r));
  const second = await b.tick();
  assert.equal(second, "standby");
  release();
  assert.equal(await first, "ran");
  assert.deepEqual(ran, ["a"]);
  // Once a released it, b can take it.
  assert.equal(await b.tick(), "ran");
  assert.deepEqual(ran, ["a", "b"]);
});

test("failure isolation: a failing batch, lock or heartbeat never rejects, keeps the schedule, logs safe codes once", async () => {
  const timers = fakeTimers();
  const logger = capturingLogger();
  const beats: EmailWorkerHeartbeat[] = [];
  const secretish = Object.assign(new Error("connect to smtp://user:pa55@mail.example as buyer@example.test failed"), { code: "ECONNREFUSED" });
  let lockFails = false;
  const lock = sharedLock().forProcess("a");
  const loop = createEmailWorkerLoop({
    lock: { tryAcquire: async () => { if (lockFails) throw Object.assign(new Error("db down postgres://x:y@h/db"), { code: "P1001" }); return lock.tryAcquire(); }, release: () => lock.release() },
    runBatch: async () => { throw secretish; },
    heartbeat: { write: async (beat) => { beats.push(beat); } },
    logger,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  loop.start();
  await timers.fire();
  await timers.fire();
  assert.equal(timers.pending.length, 1, "still scheduled after two failures");
  assert.equal(beats.at(-1)!.lastPollErrorCode, "ECONNREFUSED");
  assert.equal(beats.at(-1)!.lastPollErrorType, "Error");
  const batchErrors = logger.lines.filter((line) => line.includes("batch failed"));
  assert.equal(batchErrors.length, 1, "same failure logged once");
  lockFails = true;
  assert.equal(await loop.tick(), "lock_error");
  const output = logger.lines.join("\n");
  for (const forbidden of ["buyer@example.test", "pa55", "mail.example", "postgres://", "db down"]) assert.ok(!output.includes(forbidden), forbidden);
  assert.match(output, /\(P1001\)/);

  // A heartbeat store failure does not stop sending.
  let sent = 0;
  const loop2 = createEmailWorkerLoop({
    lock: sharedLock().forProcess("b"),
    runBatch: async () => { sent++; return { processed: 1, sent: 1, failed: 0 }; },
    heartbeat: { write: async () => { throw Object.assign(new Error("relation does not exist"), { code: "P2021" }); } },
    logger: capturingLogger(),
    setTimer: () => undefined,
    clearTimer: () => undefined,
  });
  assert.equal(await loop2.tick(), "ran");
  assert.equal(sent, 1);
  await loop.stop();
});

test("SMTP not configured is recorded as SMTP_NOT_CONFIGURED", async () => {
  const beats: EmailWorkerHeartbeat[] = [];
  const smtpMissing = Object.assign(new Error("SMTP_HOST ..."), { name: "SmtpConfigurationError" });
  const loop = createEmailWorkerLoop({
    lock: sharedLock().forProcess("a"),
    runBatch: async () => { throw smtpMissing; },
    heartbeat: { write: async (beat) => { beats.push(beat); } },
    logger: capturingLogger(),
    setTimer: () => undefined,
    clearTimer: () => undefined,
  });
  await loop.tick();
  assert.equal(beats.at(-1)!.lastPollErrorCode, "SMTP_NOT_CONFIGURED");
  assert.equal(beats.at(-1)!.lastPollErrorType, "SmtpConfigurationError");
});

test("stop: no further ticks, waits for the running batch, records stoppedAt only if this loop held the lock", async () => {
  const timers = fakeTimers();
  const beats: EmailWorkerHeartbeat[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let finished = false;
  const loop = createEmailWorkerLoop({
    lock: sharedLock().forProcess("a"),
    runBatch: async () => { await gate; finished = true; return { processed: 0, sent: 0, failed: 0 }; },
    heartbeat: { write: async (beat) => { beats.push(beat); } },
    logger: capturingLogger(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  loop.start();
  const running = loop.tick();
  const stopping = loop.stop();
  assert.equal(timers.pending.length, 0, "timer cleared");
  release();
  await running;
  await stopping;
  assert.equal(finished, true, "the batch was not interrupted");
  assert.ok(beats.at(-1)!.stoppedAt);
  assert.equal(await loop.tick(), "stopped");
  assert.equal(loop.running, false);

  // A standby loop (never held the lock) does not mark the shared heartbeat stopped.
  const standbyBeats: EmailWorkerHeartbeat[] = [];
  const busy = sharedLock();
  await busy.forProcess("other").tryAcquire();
  const standby = createEmailWorkerLoop({ lock: busy.forProcess("me"), runBatch: async () => ({ processed: 0, sent: 0, failed: 0 }), heartbeat: { write: async (beat) => { standbyBeats.push(beat); } }, logger: capturingLogger(), setTimer: () => undefined, clearTimer: () => undefined });
  standby.start();
  assert.equal(await standby.tick(), "standby");
  await busy.forProcess("other").release();
  await standby.stop();
  assert.equal(standbyBeats.length, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Advisory lock adapter

test("advisory lock adapter: pg_try_advisory_lock / pg_advisory_unlock on one session, no in-process re-entry", async () => {
  const { createAdvisoryOutboxLock, singleConnectionDatabaseUrl, EMAIL_OUTBOX_LOCK_KEY } = await import("@/lib/email-worker-runtime");
  const queries: string[] = [];
  let answer = true;
  const client = { $queryRaw: async (sql: { sql: string; values: unknown[] }) => { queries.push(`${sql.sql}|${sql.values.join(",")}`); return sql.sql.includes("pg_try_advisory_lock") ? [{ locked: answer }] : [{ unlocked: true }]; } };
  const lock = createAdvisoryOutboxLock(client as never);
  assert.equal(await lock.tryAcquire(), true);
  assert.equal(await lock.tryAcquire(), false, "second caller in the same process is refused without a query");
  assert.equal(queries.length, 1);
  await lock.release();
  await lock.release(); // no double unlock
  assert.equal(queries.length, 2);
  assert.match(queries[0], new RegExp(`pg_try_advisory_lock\\(CAST\\((?:\\?|\\$1) AS bigint\\)\\).*\\|${EMAIL_OUTBOX_LOCK_KEY}$`));
  assert.match(queries[1], /pg_advisory_unlock/);
  answer = false;
  assert.equal(await lock.tryAcquire(), false, "held by another process");
  answer = true;
  assert.equal(await lock.tryAcquire(), true, "flag reset after a refused attempt");

  const url = new URL(singleConnectionDatabaseUrl("postgresql://app:p%40ss%2Fw@db.internal:5432/bagati?schema=public&connection_limit=10"));
  assert.equal(url.searchParams.get("connection_limit"), "1");
  assert.equal(url.searchParams.get("pool_timeout"), "10");
  assert.equal(url.searchParams.get("schema"), "public");
  assert.equal(url.password, "p%40ss%2Fw", "password encoding kept");
});

test("drainEmailOutboxNow: busy while the lock is held elsewhere; otherwise one batch and the lock is released", async () => {
  const { drainEmailOutboxNow } = await import("@/lib/email-worker-runtime");
  const lock = sharedLock();
  await lock.forProcess("loop").tryAcquire();
  let batches = 0;
  const run = async () => { batches++; return { processed: 3, sent: 2, failed: 1 }; };
  assert.deepEqual(await drainEmailOutboxNow(lock.forProcess("button"), run), { status: "busy" });
  assert.equal(batches, 0);
  await lock.forProcess("loop").release();
  assert.deepEqual(await drainEmailOutboxNow(lock.forProcess("button"), run), { status: "ran", result: { processed: 3, sent: 2, failed: 1 } });
  assert.equal(lock.holder, null);
  await assert.rejects(drainEmailOutboxNow(lock.forProcess("button"), async () => { throw new Error("x"); }));
  assert.equal(lock.holder, null, "released after a failure too");
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Staleness

function outboxDatabase(rows: Array<{ id: string; template: string; createdAt: Date }>) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const payload = { encrypted: encryptEmailSecret(JSON.stringify({ name: "Test", url: "https://shopbagati.com/x" })) };
  const candidates = rows.map((row) => ({ ...row, recipient: `${row.id}@example.test`, payload, dedupeKey: `k-${row.id}`, attempts: 0, availableAt: new Date(Date.now() - 1_000) }));
  return {
    updates,
    database: {
      emailOutbox: {
        updateMany: async () => ({ count: 1 }),
        findMany: async () => candidates,
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { updates.push({ id: where.id, data }); return {}; },
      },
      emailVerification: { findUnique: async () => null },
      user: { findFirst: async () => null },
      $queryRaw: async () => [],
    },
  };
}

test("staleness: MESSAGE_TO_STORE / MESSAGE_TO_CUSTOMER older than 24 h are FAILED NOTIFICATION_STALE and never sent", async () => {
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-chars";
  try {
    assert.equal(NOTIFICATION_MAX_AGE_MS, 24 * 60 * 60 * 1000);
    assert.deepEqual([...AGE_LIMITED_TEMPLATES].sort(), ["MESSAGE_TO_CUSTOMER", "MESSAGE_TO_STORE"]);
    const now = Date.now();
    const hours = (h: number) => new Date(now - h * 60 * 60 * 1000);
    const { database, updates } = outboxDatabase([
      { id: "old-store", template: "MESSAGE_TO_STORE", createdAt: hours(25) },
      { id: "old-customer", template: "MESSAGE_TO_CUSTOMER", createdAt: hours(24.01) },
      { id: "old-welcome", template: "WELCOME_CUSTOMER", createdAt: hours(72) },
    ]);
    const sent: string[] = [];
    const result = await processEmailOutboxBatch(25, {
      prisma: database as never,
      assertSmtpConfigured: () => undefined,
      sendTransactionalEmail: async (_t, _p, recipient) => { sent.push(recipient); },
    });
    assert.deepEqual(sent, ["old-welcome@example.test"], "only the template without an age limit is sent");
    assert.deepEqual(result, { processed: 3, sent: 1, failed: 2 });
    for (const id of ["old-store", "old-customer"]) {
      const update = updates.find((u) => u.id === id)!.data;
      assert.equal(update.status, "FAILED");
      assert.equal(update.lastErrorCode, "NOTIFICATION_STALE");
      assert.equal(update.retrySafe, false);
      assert.equal(update.failureCategory, "MESSAGE_REJECTED");
    }
    assert.equal(isNotificationTooOld("MESSAGE_TO_STORE", hours(23.9), new Date(now)), false);
    assert.equal(isNotificationTooOld("MESSAGE_TO_STORE", hours(24.1), new Date(now)), true);
    assert.equal(isNotificationTooOld("ORDER_STATUS", hours(240), new Date(now)), false);
    const diagnosis = diagnoseEmailDeliveryFailure(Object.assign(new Error("x"), { code: "NOTIFICATION_STALE" }));
    assert.deepEqual([diagnosis.diagnosticCode, diagnosis.category, diagnosis.retryable], ["NOTIFICATION_STALE", "MESSAGE_REJECTED", false]);
  } finally {
    if (saved === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = saved;
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 5. Admin buttons

function actionDeps(overrides: Partial<AdminEmailActionDependencies> = {}) {
  const calls = { rate: [] as string[], audit: [] as Array<{ actorId: string; action: string; metadata: Record<string, unknown> }> };
  const deps: AdminEmailActionDependencies = {
    csrfRejection: () => null,
    requireAdmin: async () => ({ id: "admin_1", email: "owner@shopbagati.test" }),
    consumeRateLimit: async (action, adminId) => { calls.rate.push(`${action}:${adminId}`); return true; },
    audit: async (entry) => { calls.audit.push(entry); },
    ...overrides,
  };
  return { deps, calls };
}
const post = (body?: unknown) => new Request("https://shopbagati.test/api/admin/email/test", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://shopbagati.test" }, body: body === undefined ? undefined : JSON.stringify(body) });

test("test e-mail: cross-site, non-admin, rate-limited and limiter errors never send", async () => {
  let sends = 0;
  const sendDiagnostic = async () => { sends++; };
  const crossSite = actionDeps({ csrfRejection: () => new Response(null, { status: 403 }) });
  assert.equal((await handleAdminTestEmail(post(), { ...crossSite.deps, sendDiagnostic })).status, 403);
  assert.equal(crossSite.calls.rate.length, 0);
  const anonymous = actionDeps({ requireAdmin: async () => null });
  assert.equal((await handleAdminTestEmail(post(), { ...anonymous.deps, sendDiagnostic })).status, 403);
  assert.equal(anonymous.calls.rate.length, 0);
  const limited = actionDeps({ consumeRateLimit: async () => false });
  assert.equal((await handleAdminTestEmail(post(), { ...limited.deps, sendDiagnostic })).status, 429);
  const broken = actionDeps({ consumeRateLimit: async () => { throw new Error("db"); } });
  assert.equal((await handleAdminTestEmail(post(), { ...broken.deps, sendDiagnostic })).status, 503);
  assert.equal(sends, 0);
  for (const c of [crossSite, anonymous, limited, broken]) assert.equal(c.calls.audit.length, 0);
});

test("test e-mail: goes only to the admin's own address (a body recipient is ignored) and is audited without it", async () => {
  const { deps, calls } = actionDeps();
  const recipients: string[] = [];
  const response = await handleAdminTestEmail(post({ to: "attacker@evil.test", recipient: "x@evil.test" }), { ...deps, sendDiagnostic: async (to) => { recipients.push(to); } });
  assert.equal(response.status, 200);
  assert.deepEqual(recipients, ["owner@shopbagati.test"]);
  assert.deepEqual(calls.rate, ["test:admin_1"]);
  assert.equal(calls.audit.length, 1);
  assert.equal(calls.audit[0].action, "EMAIL_TEST_SEND");
  assert.equal(calls.audit[0].actorId, "admin_1");
  assert.equal(calls.audit[0].metadata.outcome, "accepted");
  assert.ok(!JSON.stringify(calls.audit).includes("@"), "no address in the audit row");
  assert.equal(response.headers.get("cache-control"), "no-store");

  const failing = actionDeps();
  const failed = await handleAdminTestEmail(post(), { ...failing.deps, sendDiagnostic: async () => { throw Object.assign(new Error("535 auth failed for owner@shopbagati.test"), { code: "EAUTH", command: "AUTH", responseCode: 535 }); } });
  assert.equal(failed.status, 502);
  const body = await failed.json();
  assert.equal(body.category, "authentication");
  assert.ok(!JSON.stringify(body).includes("@"));
  assert.equal(failing.calls.audit[0].metadata.outcome, "failed");

  const missing = actionDeps();
  const notConfigured = await handleAdminTestEmail(post(), { ...missing.deps, sendDiagnostic: async () => { throw Object.assign(new Error("x"), { name: "SmtpConfigurationError" }); } });
  assert.equal(notConfigured.status, 503);
});

test("send queue now: same guards; busy → 409, ran → counts, SMTP missing → 503; always audited", async () => {
  let drains = 0;
  const anonymous = actionDeps({ requireAdmin: async () => null });
  assert.equal((await handleAdminOutboxDrain(post(), { ...anonymous.deps, drain: async () => { drains++; return { status: "busy" }; } })).status, 403);
  const limited = actionDeps({ consumeRateLimit: async () => false });
  assert.equal((await handleAdminOutboxDrain(post(), { ...limited.deps, drain: async () => { drains++; return { status: "busy" }; } })).status, 429);
  const crossSite = actionDeps({ csrfRejection: () => new Response(null, { status: 403 }) });
  assert.equal((await handleAdminOutboxDrain(post(), { ...crossSite.deps, drain: async () => { drains++; return { status: "busy" }; } })).status, 403);
  assert.equal(drains, 0);

  const busy = actionDeps();
  assert.equal((await handleAdminOutboxDrain(post(), { ...busy.deps, drain: async () => ({ status: "busy" }) })).status, 409);
  assert.equal(busy.calls.audit[0].metadata.outcome, "busy");
  assert.deepEqual(busy.calls.rate, ["drain:admin_1"]);

  const ran = actionDeps();
  const response = await handleAdminOutboxDrain(post(), { ...ran.deps, drain: async () => ({ status: "ran", result: { processed: 4, sent: 3, failed: 1 } }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json().then((b: Record<string, unknown>) => [b.processed, b.sent, b.failed]), [4, 3, 1]);
  assert.deepEqual(ran.calls.audit[0], { actorId: "admin_1", action: "EMAIL_OUTBOX_DRAIN", metadata: { outcome: "ran", code: null, processed: 4, sent: 3, failed: 1 } });

  const missing = actionDeps();
  assert.equal((await handleAdminOutboxDrain(post(), { ...missing.deps, drain: async () => { throw Object.assign(new Error("x"), { name: "SmtpConfigurationError" }); } })).status, 503);
  assert.equal(missing.calls.audit[0].metadata.code, "SMTP_NOT_CONFIGURED");
});

test("routes: POST only, nodejs runtime, wired to the guarded handlers; the test route takes no recipient", () => {
  for (const path of ["app/api/admin/email/test/route.ts", "app/api/admin/email/drain/route.ts"]) {
    const source = read(path);
    assert.match(source, /export const runtime = "nodejs";/, path);
    assert.doesNotMatch(source, /export async function (GET|PUT|PATCH|DELETE)/, path);
    assert.match(source, /\.\.\.adminEmailActionDependencies/, path);
    assert.match(source, /const admin = await requireRole\("ADMIN"\);\s*return admin \? \{ id: admin\.id, email: admin\.email \} : null;/, path);
  }
  const testRoute = read("app/api/admin/email/test/route.ts");
  assert.doesNotMatch(testRoute, /request\.json|formData|searchParams/);
  const runtime = read("lib/admin-email-action-runtime.ts");
  assert.match(runtime, /csrfRejection\(request\)/);
  assert.match(runtime, /consumeAuthRateLimit\(/);
  assert.match(runtime, /auditLog\.create/);
});

// ---------------------------------------------------------------------------------------------------------------
// 6. Status card heartbeat

test("status card heartbeat: database row read and validated; newer of database and file wins; errors give null", async () => {
  const at = (s: number) => new Date(Date.UTC(2026, 10, 17, 12, 0, s));
  const row = { id: "email-outbox", startedAt: at(0), heartbeatAt: at(30), lastPollStartedAt: at(25), lastPollCompletedAt: at(29), lastSuccessfulPollAt: at(29), lastPollErrorCode: null, lastPollErrorType: null, lastPollProcessed: 1, lastPollSent: 1, lastPollFailed: 0, stoppedAt: null, updatedAt: at(30) };
  const fromDb = await readEmailWorkerHeartbeatFromDatabase({ emailWorkerHeartbeat: { findUnique: async () => row } } as never);
  assert.equal(fromDb?.heartbeatAt, at(30).toISOString());
  assert.equal(fromDb?.lastPollSent, 1);
  assert.equal(await readEmailWorkerHeartbeatFromDatabase({ emailWorkerHeartbeat: { findUnique: async () => { throw Object.assign(new Error("missing table"), { code: "P2021" }); } } } as never), null);
  assert.equal(await readEmailWorkerHeartbeatFromDatabase({ emailWorkerHeartbeat: { findUnique: async () => ({ ...row, lastPollErrorCode: "leak@example.test" }) } } as never), null, "unsafe values rejected");
  const file = { ...fromDb!, heartbeatAt: at(10).toISOString() };
  assert.equal(newestEmailWorkerHeartbeat(fromDb, file).source, "database");
  assert.equal(newestEmailWorkerHeartbeat({ ...fromDb!, heartbeatAt: at(5).toISOString() }, file).source, "file");
  assert.equal(newestEmailWorkerHeartbeat(null, null).heartbeat, null);
  const cards = read("lib/admin-system-status-cards.ts");
  assert.match(cards, /readEmailWorkerHeartbeatFromDatabase\(prisma\)/);
  assert.match(cards, /inProcessWorkerEnabled: emailWorkerEnabled\(\)/);
});
