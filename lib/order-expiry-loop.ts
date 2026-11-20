/**
 * The in-process unpaid-order expiry loop (SCALE-FIX-4 B5): every 5 minutes run one expiry tick (lib/order-expiry.ts).
 *
 * Pure orchestration (tick, timers, logger injected) so it is unit-tested without a database or real timers. Production
 * wiring: lib/order-expiry-runtime.ts, started from instrumentation.ts only when Epoint is configured.
 *
 * Guarantees (same as the email worker loop):
 *  - never throws out of a timer callback, so a failing tick can never crash the web server;
 *  - at most one tick at a time in this process (the next one is scheduled only after the previous one ended);
 *  - logs carry counts and allowlisted codes only (no order ids, people, amounts or raw errors);
 *  - the same state while idle ("off", "epoint_not_configured") is logged once, not every tick.
 * Across processes no lock is needed: every order is expired under `FOR UPDATE SKIP LOCKED` with a re-check and a
 * compare-and-set, so two loops at worst split the work.
 */
import type { ExpiryTickResult } from "@/lib/order-expiry";

export const ORDER_EXPIRY_INTERVAL_MS = 5 * 60_000;
/** First tick one minute after start, so the server finishes booting first. */
export const ORDER_EXPIRY_FIRST_TICK_MS = 60_000;
/** An order whose Epoint attempt is still open is retried after this long, not every tick. */
export const ORDER_EXPIRY_IN_FLIGHT_BACKOFF_MS = 30 * 60_000;
const BACKOFF_MAX_ENTRIES = 500;

type TimerHandle = { unref?: () => unknown } | number | undefined;
export type ExpiryLogger = { info(message: string): void; error(message: string): void };

export type OrderExpiryLoopDependencies = {
  runTick: (excludeIds: readonly string[]) => Promise<ExpiryTickResult>;
  logger?: ExpiryLogger;
  now?: () => number;
  intervalMs?: number;
  firstTickMs?: number;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
};

/** One JSON log line for a tick: counts only. */
export function orderExpiryLogLine(result: ExpiryTickResult | { state: "tick_failed"; code: string }): string {
  if (result.state !== "ran") return JSON.stringify({ event: "order_expiry", state: result.state, ...("code" in result ? { code: result.code } : {}) });
  const { minutes, candidates, expired, skippedLocked, skippedPaid, skippedInFlight, skippedClaim, skippedOther, errors, errorCodes } = result;
  return JSON.stringify({ event: "order_expiry", state: "ran", minutes, candidates, expired, skipped_locked: skippedLocked, skipped_paid: skippedPaid, skipped_inflight: skippedInFlight, skipped_claim: skippedClaim, skipped_other: skippedOther, errors, ...(errorCodes.length ? { error_codes: errorCodes.slice(0, 5) } : {}) });
}

export function createOrderExpiryLoop(dependencies: OrderExpiryLoopDependencies) {
  const {
    runTick,
    logger = console,
    now = () => Date.now(),
    intervalMs = ORDER_EXPIRY_INTERVAL_MS,
    firstTickMs = ORDER_EXPIRY_FIRST_TICK_MS,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = dependencies;
  let timer: TimerHandle;
  let stopped = true;
  let running = false;
  let lastIdleState = "";
  /** order id -> time (ms) before which it is left out (its Epoint attempt was still open). */
  const backoff = new Map<string, number>();

  function excluded(): string[] {
    const current = now();
    for (const [id, until] of backoff) if (until <= current) backoff.delete(id);
    return [...backoff.keys()];
  }

  async function tick(): Promise<ExpiryTickResult | null> {
    if (running) return null;
    running = true;
    try {
      const result = await runTick(excluded());
      if (result.state === "ran") {
        lastIdleState = "";
        for (const id of result.inFlightIds) if (backoff.size < BACKOFF_MAX_ENTRIES) backoff.set(id, now() + ORDER_EXPIRY_IN_FLIGHT_BACKOFF_MS);
        if (result.candidates > 0 || result.errors > 0) logger.info(orderExpiryLogLine(result));
      } else if (result.state !== lastIdleState) {
        lastIdleState = result.state;
        logger.info(orderExpiryLogLine(result));
      }
      return result;
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error && /^P\d{4}$/.test(String((error as { code?: unknown }).code)) ? String((error as { code: unknown }).code) : "TICK_FAILED";
      logger.error(orderExpiryLogLine({ state: "tick_failed", code }));
      return null;
    } finally {
      running = false;
    }
  }

  function schedule(ms: number) {
    if (stopped) return;
    timer = setTimer(() => { void tick().finally(() => schedule(intervalMs)); }, ms);
    if (timer && typeof timer === "object" && typeof timer.unref === "function") timer.unref();
  }

  return {
    start() { if (!stopped) return; stopped = false; schedule(firstTickMs); },
    stop() { stopped = true; if (timer !== undefined) clearTimer(timer); timer = undefined; },
    /** One tick now (tests). */
    tick,
    get backoffSize() { return backoff.size; },
  };
}

export type OrderExpiryLoop = ReturnType<typeof createOrderExpiryLoop>;
