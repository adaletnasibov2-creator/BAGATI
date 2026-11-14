/**
 * Admin preview during maintenance: a signed-in admin still sees the public pages (APIs stay blocked). Edge-safe.
 *
 * The session cookie carries no role, so the middleware asks /api/maintenance-state/viewer (Node, the normal admin
 * check against the database) with ONLY the session cookie, on the same origin as the state check. The answer is
 * cached per session for 10 s (keyed by a SHA-256 of the token, never the token itself). Any failure means "no
 * bypass": the visitor sees the maintenance page, which is the safe side.
 */
export const MAINTENANCE_PREVIEW_TTL_MS = 10_000;
const TIMEOUT_MS = 1_500;
const MAX_ENTRIES = 500;
const cache = new Map<string, { admin: boolean; expires: number }>();

export function resetMaintenancePreviewCache() { cache.clear(); }

async function tokenKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function isAdminPreview(token: string | undefined, origin: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<boolean> {
  if (!token || token.length > 4096) return false;
  const key = await tokenKey(token);
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.admin;
  let admin = false;
  try {
    const response = await fetcher(new URL("/api/maintenance-state/viewer", origin), {
      cache: "no-store", headers: { accept: "application/json", cookie: `bagati_session=${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = response.ok ? await response.json().catch(() => null) as { admin?: unknown } | null : null;
    admin = body?.admin === true;
  } catch {
    admin = false;
  }
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, { admin, expires: now + MAINTENANCE_PREVIEW_TTL_MS });
  return admin;
}
