import { loadEnvFile } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { safeEmailFailureType, safeWorkerFailureCode } from "@/lib/email-outbox-core";
import {
  EMAIL_WORKER_HEARTBEAT_INTERVAL_MS,
  type EmailWorkerHeartbeat,
  writeEmailWorkerHeartbeat,
} from "@/lib/email-worker-monitoring";

try { loadEnvFile(".env"); } catch { /* Production environments provide variables directly. */ }

const WATCH_INTERVAL_MS = 30_000;

async function main() {
  const { processEmailOutboxBatch } = await import("@/lib/email-outbox-worker");
  const args = process.argv.slice(2);
  const watch = args.includes("--watch");
  const targetIndex = args.indexOf("--id");
  if (targetIndex !== -1) {
    const targetOutboxId = args[targetIndex + 1];
    if (watch || args.length !== 2 || targetIndex !== 0 || !targetOutboxId || !/^[a-z0-9_-]{1,128}$/i.test(targetOutboxId)) {
      throw new Error("Usage: npm.cmd run email:worker -- --id <outbox-id>");
    }
    const result = await processEmailOutboxBatch(1, undefined, targetOutboxId);
    console.log(`Targeted email outbox batch complete: processed=${result.processed}, sent=${result.sent}, failed=${result.failed}.`);
    return;
  }
  if (args.some(argument => argument !== "--watch") || (watch && args.length !== 1)) {
    throw new Error("Usage: npm.cmd run email:worker [-- --watch]");
  }
  if (!watch) {
    const result = await processEmailOutboxBatch();
    console.log(`Email outbox batch complete: processed=${result.processed}, sent=${result.sent}, failed=${result.failed}.`);
    return;
  }

  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const now = new Date().toISOString();
  let heartbeat: EmailWorkerHeartbeat = {
    version: 1,
    startedAt: now,
    heartbeatAt: now,
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
  let heartbeatWrite = Promise.resolve();
  const persistHeartbeat = async () => {
    heartbeat = { ...heartbeat, heartbeatAt: new Date().toISOString() };
    heartbeatWrite = heartbeatWrite.catch(() => undefined).then(() => writeEmailWorkerHeartbeat(heartbeat));
    try {
      await heartbeatWrite;
    } catch (error) {
      console.error(`Email worker heartbeat write failed (${safeWorkerFailureCode(error)}).`);
    }
  };
  await persistHeartbeat();
  const heartbeatTimer = setInterval(() => { void persistHeartbeat(); }, EMAIL_WORKER_HEARTBEAT_INTERVAL_MS);
  console.log(`Email outbox worker started; polling every ${WATCH_INTERVAL_MS / 1000}s. Press Ctrl+C to stop.`);
  try {
    while (!shutdown.signal.aborted) {
      heartbeat = { ...heartbeat, lastPollStartedAt: new Date().toISOString() };
      await persistHeartbeat();
      try {
        const result = await processEmailOutboxBatch();
        const completedAt = new Date().toISOString();
        heartbeat = {
          ...heartbeat,
          lastPollCompletedAt: completedAt,
          lastSuccessfulPollAt: completedAt,
          lastPollErrorCode: null,
          lastPollErrorType: null,
          lastPollProcessed: result.processed,
          lastPollSent: result.sent,
          lastPollFailed: result.failed,
        };
        await persistHeartbeat();
        console.log(`Email outbox poll complete: processed=${result.processed}, sent=${result.sent}, failed=${result.failed}.`);
      } catch (error) {
        heartbeat = {
          ...heartbeat,
          lastPollCompletedAt: new Date().toISOString(),
          lastPollErrorCode: safeWorkerFailureCode(error),
          lastPollErrorType: safeEmailFailureType(error),
          lastPollProcessed: null,
          lastPollSent: null,
          lastPollFailed: null,
        };
        await persistHeartbeat();
        console.error(`Email outbox batch failed (${safeWorkerFailureCode(error)}); the worker will retry after ${WATCH_INTERVAL_MS / 1000}s.`);
      }
      try {
        await delay(WATCH_INTERVAL_MS, undefined, { signal: shutdown.signal });
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) throw error;
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
    heartbeat = { ...heartbeat, stoppedAt: new Date().toISOString() };
    await persistHeartbeat();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    console.log("Email outbox worker stopped.");
  }
}

main().catch((error: unknown) => {
  console.error(`Email outbox worker failed (${safeWorkerFailureCode(error)}).`);
  process.exitCode = 1;
});
