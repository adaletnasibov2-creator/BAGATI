/**
 * Where the middleware reads the maintenance state from. Edge-safe and pure (unit-tested).
 *
 * Why: under `next start` the middleware's request.nextUrl.origin is "<X-Forwarded-Proto>://localhost:<port>". Behind
 * Cloudflare + the Cloudways proxy that header is "https", so the state request went to https://localhost:3000, a
 * plain-HTTP port: the TLS handshake failed (ERR_SSL_WRONG_VERSION_NUMBER) and the check silently failed open.
 *
 * BAGATI_INTERNAL_ORIGIN (optional) points the middleware straight at the Node process, e.g. http://127.0.0.1:3000
 * (the port PM2 runs `next start` on). Accepted only as http(s) with no path, query, fragment or credentials, and only
 * for a loopback or private-network IP literal or "localhost", so a typo can never send requests to the internet.
 * No Host header is sent: Next routes by path, not by host, and the origin must be the Node port itself, not the
 * nginx/Varnish vhost in front of it (which would need the public Host header).
 */
export type InternalOrigin = { origin: string } | { ignored: string } | null;

function isPrivateOrLoopbackIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isPrivateOrLoopbackIPv6(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  return bare === "::1" || /^f[cd][0-9a-f]{2}:/.test(bare);
}

/** null = not set (use the request origin as before); { ignored } = set but invalid (warn, use the request origin). */
export function parseInternalOrigin(raw: string | undefined | null): InternalOrigin {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return { ignored: "not a URL" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ignored: "only http or https" };
  if (url.username || url.password) return { ignored: "credentials are not allowed" };
  if (url.pathname !== "/" || url.search || url.hash || /[?#]/.test(value)) return { ignored: "no path, query or fragment allowed" };
  const host = url.hostname.toLowerCase();
  if (host !== "localhost" && !isPrivateOrLoopbackIPv4(host) && !isPrivateOrLoopbackIPv6(host)) return { ignored: "host must be localhost, a loopback or a private IP" };
  return { origin: url.origin };
}

let warnedFor: string | null = null;

/** The origin the middleware should use for the state request. Warns once per process (per value) when the env is invalid. */
export function maintenanceStateOrigin(requestOrigin: string, raw: string | undefined | null, warn: (message: string) => void = console.warn): { origin: string; source: "internal" | "request" } {
  const parsed = parseInternalOrigin(raw);
  if (parsed && "origin" in parsed) return { origin: parsed.origin, source: "internal" };
  if (parsed && "ignored" in parsed && warnedFor !== raw) {
    warnedFor = raw ?? null;
    warn(`[maintenance] BAGATI_INTERNAL_ORIGIN ignored (${parsed.ignored}); using the request origin.`);
  }
  return { origin: requestOrigin, source: "request" };
}

export function resetInternalOriginWarning() { warnedFor = null; }
