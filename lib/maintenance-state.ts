/**
 * Maintenance state for the Edge middleware, which cannot read the database: it asks /api/maintenance-state
 * (served by the Node runtime from the settings engine's 30 s cache) and keeps the answer for 10 seconds.
 *
 * Fail-open: when the state cannot be read (timeout, network, bad response) the last known state is used, or "off"
 * if there is none, so a broken check never takes the site down. One request at a time per process.
 */
import { MAINTENANCE_MESSAGE_DEFAULT } from "@/lib/maintenance-defaults";

export type MaintenanceState = { enabled: boolean; message: string };

export const MAINTENANCE_STATE_TTL_MS = 10_000;
const TIMEOUT_MS = 1_500;
const OFF: MaintenanceState = { enabled: false, message: MAINTENANCE_MESSAGE_DEFAULT };

let cached: { state: MaintenanceState; expires: number } | null = null;
let inFlight: Promise<MaintenanceState> | null = null;

export function resetMaintenanceStateCache() {
  cached = null;
  inFlight = null;
}

function parseState(body: unknown): MaintenanceState | null {
  if (!body || typeof body !== "object") return null;
  const { enabled, message } = body as Record<string, unknown>;
  if (typeof enabled !== "boolean") return null;
  return { enabled, message: typeof message === "string" && message.trim() ? message.slice(0, 300) : MAINTENANCE_MESSAGE_DEFAULT };
}

export async function maintenanceState(origin: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<MaintenanceState> {
  if (cached && cached.expires > now) return cached.state;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetcher(new URL("/api/maintenance-state", origin), { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const state = response.ok ? parseState(await response.json()) : null;
      if (!state) throw new Error("bad maintenance state");
      cached = { state, expires: now + MAINTENANCE_STATE_TTL_MS };
      return state;
    } catch {
      const fallback = cached?.state ?? OFF;
      cached = { state: fallback, expires: now + MAINTENANCE_STATE_TTL_MS };
      return fallback;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
