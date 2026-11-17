/**
 * Production wiring of the in-process email worker (Node.js runtime only; imported from instrumentation.ts and the
 * admin "Növbəni indi göndər" route).
 *
 * The outbox lock is a PostgreSQL session-level advisory lock (pg_try_advisory_lock). A session lock must be taken and
 * released on the SAME connection, which Prisma's shared pool cannot promise, so the lock uses its own PrismaClient
 * limited to one connection. If that connection drops, PostgreSQL releases the lock by itself. One extra database
 * connection per app process is the cost. Row-level compare-and-set in processEmailOutboxBatch still prevents a
 * double send even if two batches ever overlapped; the lock avoids the wasted work and keeps one sender.
 *
 * State lives on globalThis because instrumentation.ts and route handlers are separate bundles in one process.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { processEmailOutboxBatch } from "@/lib/email-outbox-worker";
import { writeEmailWorkerHeartbeatToDatabase } from "@/lib/email-worker-heartbeat-store";
import {
  createEmailWorkerLoop,
  shouldStartInProcessEmailWorker,
  workerFailureCode,
  type EmailWorkerLoop,
  type OutboxBatchResult,
  type OutboxLock,
} from "@/lib/email-worker-loop";

/** Fixed key shared by every BAGATI process (and only by the email outbox). */
export const EMAIL_OUTBOX_LOCK_KEY = "72411202611180001";

type LockClient = Pick<PrismaClient, "$queryRaw">;

/**
 * A session advisory lock on one dedicated connection. Session locks are re-entrant for the same connection, so an
 * in-process flag makes a second caller in this process get "busy" instead of silently sharing the lock.
 */
export function createAdvisoryOutboxLock(client: LockClient, key: string = EMAIL_OUTBOX_LOCK_KEY): OutboxLock {
  let held = false;
  return {
    async tryAcquire() {
      if (held) return false;
      held = true;
      let acquired = false;
      try {
        const rows = await client.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`SELECT pg_try_advisory_lock(CAST(${key} AS bigint)) AS "locked"`);
        acquired = rows[0]?.locked === true;
        return acquired;
      } finally {
        if (!acquired) held = false;
      }
    },
    async release() {
      if (!held) return;
      try {
        await client.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(CAST(${key} AS bigint)) AS "unlocked"`);
      } finally {
        held = false;
      }
    },
  };
}

/** DATABASE_URL with connection_limit=1 (the lock's own session). The URL is never logged. */
export function singleConnectionDatabaseUrl(raw: string) {
  const url = new URL(raw);
  url.searchParams.set("connection_limit", "1");
  if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "10");
  return url.toString();
}

type RuntimeState = { lockClient?: PrismaClient; lock?: OutboxLock; loop?: EmailWorkerLoop; signalsBound?: boolean };
const globalStore = globalThis as typeof globalThis & { __bagatiEmailWorkerRuntime?: RuntimeState };

function runtimeState(): RuntimeState {
  globalStore.__bagatiEmailWorkerRuntime ??= {};
  return globalStore.__bagatiEmailWorkerRuntime;
}

function lockClient(): PrismaClient {
  const state = runtimeState();
  if (!state.lockClient) {
    const raw = process.env.DATABASE_URL;
    if (!raw) throw Object.assign(new Error("DATABASE_URL is not set."), { code: "WORKER_FAILED" });
    state.lockClient = new PrismaClient({ datasourceUrl: singleConnectionDatabaseUrl(raw) });
  }
  return state.lockClient;
}

/** The one outbox lock of this process, shared by the loop and the admin button. */
export function sharedOutboxLock(): OutboxLock {
  const state = runtimeState();
  state.lock ??= createAdvisoryOutboxLock(lockClient());
  return state.lock;
}

/**
 * Starts the loop when EMAIL_WORKER_ENABLED=true in the Node.js runtime (see shouldStartInProcessEmailWorker).
 * Returns null when it does not start. Never throws: a wiring problem is logged with a safe code and the server runs on.
 */
export function startInProcessEmailWorker(env: Record<string, string | undefined> = process.env): EmailWorkerLoop | null {
  if (!shouldStartInProcessEmailWorker(env)) return null;
  const state = runtimeState();
  if (state.loop) return state.loop;
  try {
    const lock = sharedOutboxLock();
    const client = lockClient();
    state.loop = createEmailWorkerLoop({
      lock,
      runBatch: () => processEmailOutboxBatch(),
      heartbeat: { write: (heartbeat) => writeEmailWorkerHeartbeatToDatabase(client, heartbeat) },
    });
    state.loop.start();
    if (!state.signalsBound && !env.NEXT_MANUAL_SIG_HANDLE) {
      state.signalsBound = true;
      // Next.js closes the server and exits on these signals; this only stops new batches and records stoppedAt.
      const stop = () => { void state.loop?.stop(); };
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
    }
    return state.loop;
  } catch (error) {
    console.error(`Email outbox worker did not start (${workerFailureCode(error)}).`);
    return null;
  }
}

export type DrainNowResult = { status: "busy" } | { status: "ran"; result: OutboxBatchResult };

/**
 * One batch now, under the same lock as the loop (admin "Növbəni indi göndər"). Works whether or not the loop is
 * enabled. Returns "busy" while another batch runs anywhere. Errors from the batch (for example SMTP missing) are
 * thrown to the caller, which maps them to a safe code.
 */
export async function drainEmailOutboxNow(
  lock: OutboxLock = sharedOutboxLock(),
  runBatch: () => Promise<OutboxBatchResult> = () => processEmailOutboxBatch(),
): Promise<DrainNowResult> {
  if (!(await lock.tryAcquire())) return { status: "busy" };
  try {
    return { status: "ran", result: await runBatch() };
  } finally {
    await lock.release().catch(() => undefined);
  }
}
