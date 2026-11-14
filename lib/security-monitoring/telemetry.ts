/**
 * In-process request telemetry for the Security Center.
 *
 * Recording is synchronous and allocation-light (a Map increment): nothing on the request path awaits, and every
 * call is wrapped so it can never throw into a request. Each process keeps per-minute counters by route group and
 * flushes them every 30 seconds with an upsert-increment, so several PM2 processes add up in the same rows.
 * No IPs, user ids, paths or query strings are recorded: only a fixed route-group name and status classes.
 */
export const TELEMETRY_FLUSH_INTERVAL_MS = 30_000;
const MAX_KEYS = 2_000;

export type MinuteCounters = {
  requests: number;
  status4xx: number;
  status5xx: number;
  authDenied: number;
  notFound: number;
  rateLimited: number;
  loginFailures: number;
  ipMismatches: number;
  durationMsSum: number;
  durationMsMax: number;
};

export type MinuteRow = MinuteCounters & { bucketStart: Date; routeGroup: string };

/** Route groups are a closed vocabulary (lower-case, matches the database CHECK). */
export const ROUTE_GROUP_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,47}$/;

const empty = (): MinuteCounters => ({ requests: 0, status4xx: 0, status5xx: 0, authDenied: 0, notFound: 0, rateLimited: 0, loginFailures: 0, ipMismatches: 0, durationMsSum: 0, durationMsMax: 0 });

export function minuteStart(time: number): Date {
  return new Date(Math.floor(time / 60_000) * 60_000);
}

/** Adds one response to counters (pure). */
export function addResponse(counters: MinuteCounters, status: number, durationMs: number): void {
  counters.requests += 1;
  if (status >= 400 && status < 500) counters.status4xx += 1;
  if (status >= 500) counters.status5xx += 1;
  if (status === 401 || status === 403) counters.authDenied += 1;
  if (status === 404) counters.notFound += 1;
  if (status === 429) counters.rateLimited += 1;
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 0;
  counters.durationMsSum += duration;
  counters.durationMsMax = Math.max(counters.durationMsMax, duration);
}

export type TelemetryWriter = (rows: MinuteRow[]) => Promise<void>;

export function createTelemetryStore(options: { write: TelemetryWriter; clock?: () => number; log?: (line: string) => void; afterFlush?: () => void }) {
  const clock = options.clock ?? Date.now;
  const log = options.log ?? ((line: string) => console.error(line));
  let buckets = new Map<string, { bucketStart: Date; routeGroup: string; counters: MinuteCounters }>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let flushing: Promise<void> | null = null;
  let lastErrorLogAt = -Infinity;
  let lastFlushAt: number | null = null;

  function bucket(routeGroup: string) {
    const group = ROUTE_GROUP_PATTERN.test(routeGroup) ? routeGroup : "other";
    const start = minuteStart(clock());
    const key = `${start.getTime()}|${group}`;
    let entry = buckets.get(key);
    if (!entry) {
      if (buckets.size >= MAX_KEYS) return null; // bounded memory: drop rather than grow
      entry = { bucketStart: start, routeGroup: group, counters: empty() };
      buckets.set(key, entry);
    }
    return entry.counters;
  }

  function safely(work: () => void) {
    try { work(); ensureTimer(); } catch { /* telemetry must never affect a request */ }
  }

  function ensureTimer() {
    if (timer) return;
    timer = setInterval(() => { void flush(); }, TELEMETRY_FLUSH_INTERVAL_MS);
    (timer as { unref?: () => void }).unref?.();
  }

  async function flush(): Promise<void> {
    if (flushing) return flushing;
    const snapshot = buckets;
    buckets = new Map();
    const rows: MinuteRow[] = [...snapshot.values()].map((entry) => ({ bucketStart: entry.bucketStart, routeGroup: entry.routeGroup, ...entry.counters }));
    if (!rows.length) {
      try { options.afterFlush?.(); } catch { /* opportunistic jobs never break telemetry */ }
      return;
    }
    flushing = (async () => {
      try {
        await options.write(rows);
        lastFlushAt = clock();
      } catch (error) {
        // Counts of this interval are dropped; the next interval starts clean. Error class only (no connection details).
        const now = clock();
        if (now - lastErrorLogAt >= 60_000) {
          lastErrorLogAt = now;
          log(JSON.stringify({ event: "security_telemetry.flush_failed", error: error instanceof Error ? error.name : "unknown", rows: rows.length }));
        }
      } finally {
        flushing = null;
        try { options.afterFlush?.(); } catch { /* opportunistic jobs never break telemetry */ }
      }
    })();
    return flushing;
  }

  return {
    recordResponse(routeGroup: string, status: number, durationMs: number) {
      safely(() => { const counters = bucket(routeGroup); if (counters) addResponse(counters, status, durationMs); });
    },
    recordLoginFailure(routeGroup: string) {
      safely(() => { const counters = bucket(routeGroup); if (counters) counters.loginFailures += 1; });
    },
    recordIpMismatch(routeGroup: string) {
      safely(() => { const counters = bucket(routeGroup); if (counters) counters.ipMismatches += 1; });
    },
    flush,
    pendingKeys: () => buckets.size,
    lastFlushAt: () => lastFlushAt,
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}

/**
 * Route group for an API path recorded by the security-event helpers (login failures, rate limits).
 * A closed mapping: unknown paths become "other".
 */
export function routeGroupForPath(path: string): string {
  const groups: [RegExp, string][] = [
    [/^\/api\/admin\/login\/2fa/, "admin.2fa"],
    [/^\/api\/admin\/2fa\//, "admin.2fa"],
    [/^\/api\/admin\/login/, "admin.login"],
    [/^\/api\/auth\/vendor-login/, "auth.vendor-login"],
    [/^\/api\/auth\/login/, "auth.login"],
    [/^\/api\/auth\/register/, "auth.register"],
    [/^\/api\/auth\/(forgot|reset)-password/, "auth.password-reset"],
    [/^\/api\/vendor\/apply/, "seller-application"],
    [/^\/api\/stores\/[^/]+\/inquiries/, "inquiry"],
    [/^\/api\/security\/ingest\//, "security.ingest"],
    [/^\/api\/admin\/security\//, "admin.security"],
  ];
  return groups.find(([pattern]) => pattern.test(path))?.[1] ?? "other";
}

/**
 * Class of a not-found page request, from the path only (never stored). Scanners look for PHP, WordPress,
 * environment and VCS files and admin panels; everything else is "other".
 */
export function notFoundGroup(pathname: string | null): string {
  const path = (pathname ?? "").toLowerCase();
  if (/\.php(\b|$)|\/php/.test(path)) return "notfound.php";
  if (/wp-|wordpress|xmlrpc/.test(path)) return "notfound.wp";
  if (/(^|\/)\.e(nv)|\.git(\/|$)|\.ht(access|passwd)|\.ds_store|\.sql$|\.bak$/.test(path)) return "notfound.secrets";
  if (/phpmyadmin|\/admin(istrator)?\b|\/manager\/|\/cgi-bin/.test(path) && !path.startsWith("/admin/")) return "notfound.admin-probe";
  if (path.startsWith("/api/")) return "notfound.api";
  return "notfound.other";
}
