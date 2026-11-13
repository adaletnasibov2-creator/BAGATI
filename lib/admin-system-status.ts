/**
 * Pure helpers for the admin system status page (/admin/system). No database or environment access here,
 * so the rules can be unit-tested. Database loaders live in `admin-system-status-cards.ts`.
 */

export const SYSTEM_STATUS_CARDS = ["database", "readiness", "email", "imports", "security", "business", "application"] as const;
export type SystemStatusCard = (typeof SYSTEM_STATUS_CARDS)[number];

/** Results are cached in process memory for this long; the "Yenilə" button may bypass it. */
export const SYSTEM_STATUS_CACHE_TTL_MS = 15_000;
/** A manual refresh still reuses a result younger than this, so repeated clicks cannot hammer the database. */
export const SYSTEM_STATUS_MIN_REFRESH_MS = 5_000;
/** Per-statement PostgreSQL limit applied with SET LOCAL inside each card's transaction. */
export const SYSTEM_STATUS_STATEMENT_TIMEOUT_MS = 2_500;
/** Import jobs in an active state that have not been updated for this long are reported as stuck. */
export const IMPORT_JOB_STUCK_AFTER_MS = 30 * 60_000;

const BAKU_OFFSET_MS = 4 * 60 * 60_000; // Asia/Baku is UTC+4 with no daylight saving time.

export function parseSystemStatusCard(value: unknown): SystemStatusCard | null {
  return typeof value === "string" && (SYSTEM_STATUS_CARDS as readonly string[]).includes(value) ? value as SystemStatusCard : null;
}

/** Start of the current calendar day in Baku, as a UTC instant. */
export function bakuStartOfDay(now: Date): Date {
  const local = now.getTime() + BAKU_OFFSET_MS;
  const dayStartLocal = local - (((local % 86_400_000) + 86_400_000) % 86_400_000);
  return new Date(dayStartLocal - BAKU_OFFSET_MS);
}

/**
 * Masks an IP address for display: IPv4 keeps the first two octets, IPv6 keeps the first two groups.
 * Anything that does not look like an IP is fully masked.
 */
export function maskIpAddress(value: string | null | undefined): string {
  const ip = (value ?? "").trim();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.*.*`;
  if (/^[0-9a-f:]+$/i.test(ip) && ip.includes(":")) {
    const groups = ip.split(":").filter(Boolean);
    return `${groups.slice(0, 2).join(":") || "0"}:*:*`;
  }
  return "***";
}

/** Migration folders present in the repository that PostgreSQL has not recorded as applied. */
export function missingMigrations(repoFolders: readonly string[], applied: readonly string[]): string[] {
  const appliedSet = new Set(applied);
  return repoFolders.filter((name) => /^\d{14}_[\w-]+$/.test(name) && !appliedSet.has(name)).sort();
}

export function postgresMajorVersion(serverVersionNum: string | number | null | undefined): number | null {
  const parsed = Number(serverVersionNum);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed / 10_000);
}

type CacheEntry<T> = { at: number; value: Promise<T> };

/** Small per-key memo with a TTL. A rejected load is evicted so the next request retries it. */
export function createTtlCache<T>(ttlMs: number, minRefreshMs: number, clock: () => number = Date.now) {
  const entries = new Map<string, CacheEntry<T>>();
  return {
    get(key: string, load: () => Promise<T>, options: { refresh?: boolean } = {}): Promise<T> {
      const now = clock();
      const existing = entries.get(key);
      const age = existing ? now - existing.at : Infinity;
      if (existing && age < (options.refresh ? minRefreshMs : ttlMs)) return existing.value;
      const value = load();
      entries.set(key, { at: now, value });
      value.catch(() => { if (entries.get(key)?.value === value) entries.delete(key); });
      return value;
    },
    clear() { entries.clear(); },
  };
}
