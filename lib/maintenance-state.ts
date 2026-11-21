/**
 * Maintenance state for the Edge middleware, which cannot read the database: it asks /api/maintenance-state
 * (served by the Node runtime from the settings engine's 30 s cache) and keeps the answer for 10 seconds while the
 * site is open. While maintenance is ON the answer is kept for only 1 second (MAINTENANCE-PAGE), so switching it off in
 * the admin panel (which clears the settings cache in the same process) shows the normal site within about a second.
 * The cost is one small local request per second while the site is closed.
 *
 * Fail-open: when the state cannot be read (timeout, network, bad response) the last known state is used, or "off"
 * if there is none, so a broken check never takes the site down. One request at a time per process.
 *
 * Fail-open is visible: every check records its result (lastMaintenanceCheck(), shown to admins in "Texniki iş"),
 * and a failing check logs at most one warning per minute (PM2 log). The origin comes from lib/maintenance-origin.ts.
 */
import { MAINTENANCE_MESSAGE_DEFAULT } from "@/lib/maintenance-defaults";

export type MaintenanceState = { enabled: boolean; message: string };
export type MaintenanceCheck = { ok: boolean; at: number; reason: string | null; source: "internal" | "request" };

export const MAINTENANCE_STATE_TTL_MS = 10_000;
/** How long an "ON" answer is kept: short, so switching maintenance off takes effect almost at once. */
export const MAINTENANCE_STATE_ON_TTL_MS = 1_000;
export const MAINTENANCE_WARNING_INTERVAL_MS = 60_000;
const TIMEOUT_MS = 1_500;
const OFF: MaintenanceState = { enabled: false, message: MAINTENANCE_MESSAGE_DEFAULT };

let cached: { state: MaintenanceState; expires: number } | null = null;
let inFlight: Promise<MaintenanceState> | null = null;
let lastCheck: MaintenanceCheck | null = null;
let lastWarningAt: number | null = null;

export function resetMaintenanceStateCache() {
  cached = null;
  inFlight = null;
  lastCheck = null;
  lastWarningAt = null;
}

/** Result of the most recent state request in this process (null before the first one). */
export function lastMaintenanceCheck(): MaintenanceCheck | null {
  return lastCheck;
}

function parseState(body: unknown): MaintenanceState | null {
  if (!body || typeof body !== "object") return null;
  const { enabled, message } = body as Record<string, unknown>;
  if (typeof enabled !== "boolean") return null;
  return { enabled, message: typeof message === "string" && message.trim() ? message.slice(0, 300) : MAINTENANCE_MESSAGE_DEFAULT };
}

class CheckError extends Error {}

/** Short, non-sensitive reason for the admin line and the log. */
export function describeCheckFailure(error: unknown): string {
  if (error instanceof CheckError) return error.message;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return `vaxt bitdi (${TIMEOUT_MS / 1000} s)`;
  const cause = error instanceof Error ? (error as Error & { cause?: { code?: unknown } }).cause : undefined;
  const code = typeof cause?.code === "string" ? cause.code : error instanceof Error ? error.name : "naməlum";
  return `bağlantı xətası (${code.slice(0, 60)})`;
}

export async function maintenanceState(
  origin: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
  options: { source?: "internal" | "request"; warn?: (message: string) => void } = {},
): Promise<MaintenanceState> {
  if (cached && cached.expires > now) return cached.state;
  if (inFlight) return inFlight;
  const source = options.source ?? "request";
  inFlight = (async () => {
    try {
      const response = await fetcher(new URL("/api/maintenance-state", origin), { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new CheckError(`HTTP ${response.status}`);
      const state = parseState(await response.json().catch(() => null));
      if (!state) throw new CheckError("cavab formatı yanlışdır");
      cached = { state, expires: now + (state.enabled ? MAINTENANCE_STATE_ON_TTL_MS : MAINTENANCE_STATE_TTL_MS) };
      lastCheck = { ok: true, at: now, reason: null, source };
      return state;
    } catch (error) {
      const fallback = cached?.state ?? OFF;
      cached = { state: fallback, expires: now + MAINTENANCE_STATE_TTL_MS };
      const reason = describeCheckFailure(error);
      lastCheck = { ok: false, at: now, reason, source };
      if (lastWarningAt === null || now - lastWarningAt >= MAINTENANCE_WARNING_INTERVAL_MS) {
        lastWarningAt = now;
        const hint = source === "request" ? " Set BAGATI_INTERNAL_ORIGIN (e.g. http://127.0.0.1:3000) to the Node port." : "";
        (options.warn ?? console.warn)(`[maintenance] state check failed via ${source} origin ${new URL(origin).origin}: ${reason}. Failing open: maintenance treated as ${fallback.enabled ? "ON (last known)" : "OFF"}.${hint}`);
      }
      return fallback;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Request header the middleware sets on admin page requests (always overwritten, so a client cannot supply it). */
export const MAINTENANCE_CHECK_HEADER = "x-bagati-maintenance-check";

/** ASCII-only header value: "1|internal|<at>|" or "0|request|<at>|<url-encoded reason>". */
export function encodeMaintenanceCheck(check: MaintenanceCheck): string {
  return `${check.ok ? 1 : 0}|${check.source}|${check.at}|${encodeURIComponent(check.reason ?? "")}`;
}

export function decodeMaintenanceCheck(value: string | null | undefined): MaintenanceCheck | null {
  const match = /^([01])\|(internal|request)\|(\d{1,15})\|([^|]{0,400})$/.exec(value ?? "");
  if (!match) return null;
  let reason: string | null = null;
  try { reason = match[4] ? decodeURIComponent(match[4]).slice(0, 120) : null; } catch { return null; }
  return { ok: match[1] === "1", source: match[2] as MaintenanceCheck["source"], at: Number(match[3]), reason: match[1] === "1" ? null : reason ?? "naməlum" };
}
