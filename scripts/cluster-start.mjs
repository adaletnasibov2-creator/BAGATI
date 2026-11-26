/**
 * MULTI-PROCESS-1: production start with several app processes, using only Node's built-in `node:cluster` (no PM2
 * config, no npm package). Start command: `npm run start:cluster` (= `node scripts/cluster-start.mjs`).
 *
 * BAGATI_WORKERS (default 1, capped at min(4, CPUs); scripts/cluster-workers.mjs):
 * - 1: Next's own CLI runs `next start` IN THIS PROCESS (same port, host, NODE_ENV and signal handling as today's
 *   `next start`). No cluster, no fork.
 * - 2+: this process is the primary. It forks that many workers; each runs the same `next start` and they share the
 *   port (Node cluster). A worker that exits unexpectedly is re-forked after 1-5 s, at most 5 times per 60 s; after
 *   that the primary stops everything and exits with code 1 so PM2 restarts the whole app. SIGTERM/SIGINT are passed
 *   to every worker (Next then finishes open requests and exits); after 15 s any worker still running is killed.
 *
 * Arguments after the script name are passed to `next start` (for example `-p 3001`). PORT works as with `next start`.
 * Log lines are JSON with pids and worker numbers only.
 */
import cluster from "node:cluster";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { createRestartLimiter, resolveWorkerCount, restartDelayMs, STOP_TIMEOUT_MS } from "./cluster-workers.mjs";

const require = createRequire(import.meta.url);
const WORKER_ENV = "BAGATI_CLUSTER_WORKER_ID";
const log = (event, fields = {}) => console.log(JSON.stringify({ event, ...fields }));

/** Exactly `next start <args>`: Next's own CLI entry, loaded in this process. */
function startNextServer() {
  const bin = require.resolve("next/dist/bin/next");
  process.argv = [process.argv[0], bin, "start", ...process.argv.slice(2)];
  require(bin);
}

function runPrimary(workers) {
  const limiter = createRestartLimiter();
  /** cluster worker id -> slot number 1..N (a replacement keeps the slot, so the log stays readable) */
  const slots = new Map();
  let stopping = false;

  const fork = (slot) => {
    const worker = cluster.fork({ [WORKER_ENV]: String(slot) });
    slots.set(worker.id, slot);
    worker.once("online", () => log("cluster_worker_start", { worker: slot, pid: worker.process.pid }));
  };

  const stopAll = (signal, exitCode) => {
    if (stopping) return;
    stopping = true;
    log("cluster_stop", { signal, workers: Object.keys(cluster.workers ?? {}).length });
    for (const worker of Object.values(cluster.workers ?? {})) worker?.process.kill(signal);
    const timer = setTimeout(() => {
      for (const worker of Object.values(cluster.workers ?? {})) worker?.process.kill("SIGKILL");
      log("cluster_stop_timeout", { killed: Object.keys(cluster.workers ?? {}).length });
      process.exit(exitCode || 1);
    }, STOP_TIMEOUT_MS);
    timer.unref();
    const done = () => { if (!Object.keys(cluster.workers ?? {}).length) process.exit(exitCode); };
    cluster.on("exit", done);
    done();
  };

  cluster.on("exit", (worker, code, signal) => {
    const slot = slots.get(worker.id);
    slots.delete(worker.id);
    if (stopping) return;
    const now = Date.now();
    log("cluster_worker_exit", { worker: slot, pid: worker.process.pid, code, signal });
    if (!limiter.allow(now)) {
      log("cluster_restart_limit", { worker: slot, restarts: limiter.recent(now) });
      stopAll("SIGTERM", 1);
      return;
    }
    // Not unref'd: when every worker is down, this timer is what keeps the primary alive until the re-fork.
    setTimeout(() => { if (!stopping) fork(slot); }, restartDelayMs(limiter.recent(now)));
  });

  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => stopAll(signal, 0));
  log("cluster_primary_start", { pid: process.pid, workers });
  for (let slot = 1; slot <= workers; slot += 1) fork(slot);
}

const workers = resolveWorkerCount(process.env.BAGATI_WORKERS, availableParallelism());
if (process.env[WORKER_ENV]) {
  // A worker forked by the primary below.
  startNextServer();
} else if (workers === 1) {
  startNextServer();
} else if (!cluster.isPrimary) {
  // Already inside someone else's cluster (e.g. PM2 cluster mode): forking is not possible here, run one server.
  log("cluster_unavailable", { pid: process.pid, requested: workers });
  startNextServer();
} else {
  runPrimary(workers);
}
