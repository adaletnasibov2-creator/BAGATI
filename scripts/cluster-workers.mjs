/**
 * MULTI-PROCESS-1: pure helpers for scripts/cluster-start.mjs (plain ESM, no dependencies, unit-tested in
 * scripts/multi-process.test.ts).
 */

/** Never more than this many app processes, whatever BAGATI_WORKERS says (4-vCPU server, PostgreSQL on the same box). */
export const MAX_WORKERS = 4;

/** A worker that dies is re-forked at most this many times per window; one more and the primary exits non-zero. */
export const RESTART_LIMIT = { max: 5, windowMs: 60_000 };

/** How long the primary waits for workers to finish their requests after SIGTERM/SIGINT before killing them. */
export const STOP_TIMEOUT_MS = 15_000;

/**
 * BAGATI_WORKERS -> number of app processes. Default 1 (= plain `next start`). Empty, not a whole number, or below 1
 * -> 1. Capped at min(MAX_WORKERS, CPUs Node may use).
 * @param {string | undefined} raw
 * @param {number} parallelism os.availableParallelism()
 * @returns {number}
 */
export function resolveWorkerCount(raw, parallelism) {
  const text = typeof raw === "string" ? raw.trim() : "";
  const requested = /^\d{1,3}$/.test(text) ? Number(text) : 1;
  const cpus = Number.isInteger(parallelism) && parallelism >= 1 ? parallelism : 1;
  return Math.max(1, Math.min(requested, MAX_WORKERS, cpus));
}

/**
 * Sliding-window restart budget, so a crash loop cannot spin forever.
 * @param {{ max: number; windowMs: number }} [limit]
 * @returns {{ allow(now: number): boolean; recent(now: number): number }}
 */
export function createRestartLimiter(limit = RESTART_LIMIT) {
  /** @type {number[]} */
  const restarts = [];
  const prune = (/** @type {number} */ now) => { while (restarts.length && now - restarts[0] >= limit.windowMs) restarts.shift(); };
  return {
    allow(now) {
      prune(now);
      if (restarts.length >= limit.max) return false;
      restarts.push(now);
      return true;
    },
    recent(now) {
      prune(now);
      return restarts.length;
    },
  };
}

/**
 * Wait before re-forking: 1 s per restart already in the window (1 s, 2 s, ... 5 s).
 * @param {number} recentRestarts
 * @returns {number}
 */
export function restartDelayMs(recentRestarts) {
  return Math.min(Math.max(recentRestarts, 1), RESTART_LIMIT.max) * 1_000;
}
