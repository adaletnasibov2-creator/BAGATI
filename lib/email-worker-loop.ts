/**
 * The in-process email worker loop: every 30 s, if this process can take the outbox lock, run one outbox batch.
 *
 * Pure orchestration: the lock, the batch, the heartbeat store, the timers and the logger are injected, so the loop is
 * unit-tested without a database, SMTP or real timers. The production wiring is in lib/email-worker-runtime.ts.
 *
 * Guarantees:
 *  - never throws out of a timer callback, so a failing batch, lock or heartbeat can never crash the web server;
 *  - at most one batch at a time in this process (the next tick is scheduled only after the previous one ended);
 *  - at most one batch at a time across processes (the advisory lock; a process without it stays on standby);
 *  - logs carry allowlisted codes and counts only (never recipients, payloads, messages or raw errors);
 *  - a repeated identical failure (for example SMTP not configured) is logged once, not every 30 s.
 */
import { safeEmailFailureType, safeWorkerFailureCode } from "@/lib/email-outbox-core";
import type { EmailWorkerHeartbeat } from "@/lib/email-worker-monitoring";

export const EMAIL_WORKER_FLAG = "EMAIL_WORKER_ENABLED";
export const EMAIL_WORKER_INTERVAL_MS = 30_000;
/** First tick shortly after start, so a restart does not wait a full interval but the server can finish booting. */
export const EMAIL_WORKER_FIRST_TICK_MS = 5_000;
/** How long stop() waits for a running batch before giving up (the batch itself is never interrupted). */
export const EMAIL_WORKER_STOP_WAIT_MS = 10_000;

type Env = Record<string, string | undefined>;

/** Exactly "true" switches the worker on. Anything else (unset, "1", "TRUE", "yes") keeps it off. */
export function emailWorkerEnabled(env: Env = process.env) {
  return env[EMAIL_WORKER_FLAG] === "true";
}

/** Only the Node.js server runtime, never Edge, never `next build`, and only with the flag. */
export function shouldStartInProcessEmailWorker(env: Env = process.env) {
  return env.NEXT_RUNTIME === "nodejs" && env.NEXT_PHASE !== "phase-production-build" && emailWorkerEnabled(env);
}

export type OutboxLock = {
  /** True when this caller now holds the lock. Must never throw for "held elsewhere"; it returns false. */
  tryAcquire(): Promise<boolean>;
  release(): Promise<void>;
};

export type OutboxBatchResult = { processed: number; sent: number; failed: number };

export type HeartbeatStore = { write(heartbeat: EmailWorkerHeartbeat): Promise<void> };

export type WorkerLogger = { info(message: string): void; error(message: string): void };

type TimerHandle = { unref?: () => unknown } | number | undefined;

export type EmailWorkerLoopDependencies = {
  lock: OutboxLock;
  runBatch: () => Promise<OutboxBatchResult>;
  heartbeat: HeartbeatStore;
  logger?: WorkerLogger;
  now?: () => Date;
  intervalMs?: number;
  firstTickMs?: number;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
};

export type TickOutcome = "ran" | "standby" | "lock_error" | "stopped";

/** Allowlisted code for the heartbeat and the log. SMTP missing gets its own readable code. */
export function workerFailureCode(error: unknown) {
  if (error instanceof Error && error.name === "SmtpConfigurationError") return "SMTP_NOT_CONFIGURED";
  return safeWorkerFailureCode(error);
}

export function createEmailWorkerLoop(dependencies: EmailWorkerLoopDependencies) {
  const {
    lock,
    runBatch,
    heartbeat: store,
    logger = console,
    now = () => new Date(),
    intervalMs = EMAIL_WORKER_INTERVAL_MS,
    firstTickMs = EMAIL_WORKER_FIRST_TICK_MS,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = dependencies;

  let timer: TimerHandle;
  let started = false;
  let stopped = false;
  let inFlight: Promise<TickOutcome> | null = null;
  let lastLoggedProblem: string | null = null;
  let everHeldLock = false;
  const startedAt = now().toISOString();
  let state: EmailWorkerHeartbeat = {
    version: 1,
    startedAt,
    heartbeatAt: startedAt,
    lastPollStartedAt: null,
    lastPollCompletedAt: null,
    lastSuccessfulPollAt: null,
    lastPollErrorCode: null,
    lastPollErrorType: null,
    lastPollProcessed: null,
    lastPollSent: null,
    lastPollFailed: null,
    stoppedAt: null,
  };

  /** Logs a problem once; logs again only when it changes or after it cleared. */
  function reportProblem(problem: string, message: string) {
    if (lastLoggedProblem === problem) return;
    lastLoggedProblem = problem;
    logger.error(message);
  }

  function clearProblem() {
    if (lastLoggedProblem === null) return;
    lastLoggedProblem = null;
    logger.info("Email outbox worker recovered.");
  }

  async function persist(next: EmailWorkerHeartbeat) {
    state = { ...next, heartbeatAt: now().toISOString() };
    try {
      await store.write(state);
    } catch (error) {
      // The heartbeat is monitoring only: sending continues without it.
      reportProblem(`heartbeat:${workerFailureCode(error)}`, `Email worker heartbeat write failed (${workerFailureCode(error)}).`);
    }
  }

  async function tickUnsafe(): Promise<TickOutcome> {
    if (stopped) return "stopped";
    let acquired = false;
    try {
      acquired = await lock.tryAcquire();
    } catch (error) {
      reportProblem(`lock:${workerFailureCode(error)}`, `Email worker could not check the outbox lock (${workerFailureCode(error)}); it will retry.`);
      return "lock_error";
    }
    if (!acquired) return "standby";
    everHeldLock = true;
    try {
      await persist({ ...state, lastPollStartedAt: now().toISOString(), stoppedAt: null });
      try {
        const result = await runBatch();
        const completedAt = now().toISOString();
        await persist({
          ...state,
          lastPollCompletedAt: completedAt,
          lastSuccessfulPollAt: completedAt,
          lastPollErrorCode: null,
          lastPollErrorType: null,
          lastPollProcessed: result.processed,
          lastPollSent: result.sent,
          lastPollFailed: result.failed,
        });
        if (lastLoggedProblem?.startsWith("batch:")) clearProblem();
        if (result.processed > 0) logger.info(`Email outbox poll complete: processed=${result.processed}, sent=${result.sent}, failed=${result.failed}.`);
      } catch (error) {
        const code = workerFailureCode(error);
        await persist({
          ...state,
          lastPollCompletedAt: now().toISOString(),
          lastPollErrorCode: code,
          lastPollErrorType: safeEmailFailureType(error),
          lastPollProcessed: null,
          lastPollSent: null,
          lastPollFailed: null,
        });
        reportProblem(`batch:${code}`, `Email outbox batch failed (${code}); the worker will retry in ${Math.round(intervalMs / 1000)}s.`);
      }
      return "ran";
    } finally {
      try {
        await lock.release();
      } catch (error) {
        reportProblem(`unlock:${workerFailureCode(error)}`, `Email worker could not release the outbox lock (${workerFailureCode(error)}).`);
      }
    }
  }

  /** One tick. Never rejects. */
  async function tick(): Promise<TickOutcome> {
    if (inFlight) return inFlight;
    inFlight = tickUnsafe().catch((error: unknown) => {
      reportProblem(`tick:${workerFailureCode(error)}`, `Email worker tick failed (${workerFailureCode(error)}).`);
      return "lock_error" as const;
    }).finally(() => { inFlight = null; });
    return inFlight;
  }

  function schedule(ms: number) {
    if (stopped) return;
    timer = setTimer(() => {
      timer = undefined;
      void tick().then(() => schedule(intervalMs), () => schedule(intervalMs));
    }, ms);
    // Never keep the process alive just for the email loop.
    if (timer && typeof timer === "object" && typeof timer.unref === "function") timer.unref();
  }

  return {
    start() {
      if (started || stopped) return;
      started = true;
      logger.info(`Email outbox worker started in-process; polling every ${Math.round(intervalMs / 1000)}s.`);
      schedule(firstTickMs);
    },
    /** Stops scheduling, waits briefly for a running batch, then records stoppedAt if no other process is active. */
    async stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
      const running = inFlight;
      if (running) {
        let waitTimer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([running, new Promise((resolve) => { waitTimer = setTimeout(resolve, EMAIL_WORKER_STOP_WAIT_MS); waitTimer.unref?.(); })]);
        if (waitTimer) clearTimeout(waitTimer);
      }
      if (!started || !everHeldLock) return;
      // Only mark the shared heartbeat stopped when nobody else holds the lock (otherwise another instance is working).
      try {
        if (await lock.tryAcquire()) {
          try { await persist({ ...state, stoppedAt: now().toISOString() }); }
          finally { await lock.release(); }
        }
      } catch {
        // Shutting down: the lock is released with the connection anyway.
      }
      logger.info("Email outbox worker stopped.");
    },
    tick,
    get heartbeat() { return state; },
    get running() { return started && !stopped; },
  };
}

export type EmailWorkerLoop = ReturnType<typeof createEmailWorkerLoop>;
