/**
 * A cached loader that never throws. Used for reads on hot paths (layouts, metadata) where a database
 * hiccup must not break the page:
 *   fresh cached value -> load -> on error: last good value -> fallback.
 * Errors are logged at most once per `logIntervalMs` per loader (error class and Prisma code only).
 * After a failure the fallback is served for `retryAfterMs` before the next attempt, so an outage does not
 * turn every request into a slow failing query. Concurrent callers share one in-flight load.
 */
export type FailSafeLoaderOptions<T> = {
  label: string;
  ttlMs: number;
  load: () => Promise<T>;
  fallback: () => T;
  retryAfterMs?: number;
  logIntervalMs?: number;
  clock?: () => number;
  log?: (line: string) => void;
};

export function createFailSafeLoader<T>(options: FailSafeLoaderOptions<T>) {
  const clock = options.clock ?? Date.now;
  const retryAfterMs = options.retryAfterMs ?? 5_000;
  const logIntervalMs = options.logIntervalMs ?? 60_000;
  const log = options.log ?? ((line: string) => console.error(line));
  let cached: { value: T; until: number } | null = null;
  let lastGood: { value: T } | null = null;
  let inFlight: Promise<T> | null = null;
  let lastLogAt = -Infinity;

  function report(error: unknown) {
    const now = clock();
    if (now - lastLogAt < logIntervalMs) return;
    lastLogAt = now;
    const name = error instanceof Error ? error.name : "unknown";
    const code = typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : undefined;
    log(JSON.stringify({ event: "cached_read.failed", label: options.label, error: name, ...(code ? { code } : {}), servedLastGood: Boolean(lastGood) }));
  }

  async function refresh(): Promise<T> {
    try {
      const value = await options.load();
      lastGood = { value };
      cached = { value, until: clock() + options.ttlMs };
      return value;
    } catch (error) {
      report(error);
      let value: T;
      try { value = lastGood ? lastGood.value : options.fallback(); } catch { value = options.fallback(); }
      cached = { value, until: clock() + retryAfterMs };
      return value;
    }
  }

  return {
    get(): Promise<T> {
      if (cached && clock() < cached.until) return Promise.resolve(cached.value);
      if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
      return inFlight;
    },
    /** Drop the cached value (after a save in this process). The last good value is kept for fallback. */
    invalidate() { cached = null; },
  };
}
