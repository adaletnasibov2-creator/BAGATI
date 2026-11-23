import { consumeAuthProcessRateLimit } from "@/lib/auth-rate-limit";
import { trustedCloudflareClientIp } from "@/lib/trusted-proxy";

/**
 * SEC-FIX-2 (L8): public search and catalog GETs (API + /products?q=, /stores?q=). IN-PROCESS ONLY: no database read
 * or write per request (the PERF / SCALE work must not regress). One shared budget for API and pages:
 * - per trusted client IP: 120 / minute (infinite scroll and typing stay far below this);
 * - for the whole process: 3000 / minute. Without a trusted client IP (BAGATI_TRUST_CLOUDFLARE_IP not set) this is
 *   the only limit, kept high so that real visitors sharing it never notice.
 * The raw IP lives only in this process's memory (the bucket map), never in the database or logs.
 */
export const PUBLIC_SEARCH_IP_LIMIT = { limit: 120, windowMs: 60_000 } as const;
export const PUBLIC_SEARCH_PROCESS_LIMIT = { limit: 3000, windowMs: 60_000 } as const;

type ProcessLimiter = (key: string, limit: number, windowMs: number) => boolean;

export function allowPublicSearch(headers: Headers, consume: ProcessLimiter = consumeAuthProcessRateLimit): boolean {
  const ip = trustedCloudflareClientIp(headers);
  if (ip && !consume(`public-search:ip:${ip}`, PUBLIC_SEARCH_IP_LIMIT.limit, PUBLIC_SEARCH_IP_LIMIT.windowMs)) return false;
  return consume("public-search:process", PUBLIC_SEARCH_PROCESS_LIMIT.limit, PUBLIC_SEARCH_PROCESS_LIMIT.windowMs);
}

/** Runs the page's search only when it is within the budget; otherwise no query runs and nothing is listed. */
export function limitedSearch<R>(limited: boolean, run: () => Promise<R>): Promise<R> {
  return limited ? Promise.resolve(emptySearchPage<never>() as unknown as R) : run();
}

/** Stand-in for a search page when the budget is used up: no query runs, nothing is listed. */
export function emptySearchPage<T>(): { items: T[]; pageSize: number; total: number | null; hasNext: boolean; hasPrevious: boolean; nextCursor: string | null; previousCursor: string | null } {
  return { items: [], pageSize: 0, total: 0, hasNext: false, hasPrevious: false, nextCursor: null, previousCursor: null };
}
