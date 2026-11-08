import { NextResponse } from "next/server";

/**
 * Shared cross-site request protection for cookie-authenticated, state-changing routes.
 *
 * Header-based so it behaves the same in Edge middleware and in route handlers, and proxy-safe:
 * it does not trust the protocol Next.js reconstructs for `request.url`, and it does not read
 * forwarded host or protocol headers.
 *
 * Policy:
 *  1. GET, HEAD, and OPTIONS are never blocked.
 *  2. `Sec-Fetch-Site: cross-site` is rejected. `same-site` continues to the Origin check so
 *     the apex host can accept a request from its own www host. A foreign origin still fails.
 *  3. `Origin`, when present, must be a trusted origin. `Origin: null` and unparseable values are rejected.
 *  4. Otherwise `Referer`, when present, must resolve to a trusted origin.
 *  5. A state-changing request with neither Origin nor Referer is rejected.
 *  6. Trusted origins are the browser `Host` and `APP_BASE_URL`. The host inside `request.url`
 *     is used only when `Host` is absent, because Next.js may rewrite that URL to a different
 *     loopback name. `localhost` and `127.0.0.1` stay distinct. In production, plain HTTP is
 *     trusted only for loopback, private IPv4, and single-label machine names. Public dotted
 *     hosts require HTTPS.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const EXEMPT_API_PREFIXES = ["/api/security/ingest/", "/api/health"];
/** Epoint's server callback has no browser origin. The route still requires the documented signature. */
const EPOINT_CALLBACK_PATH = "/api/payments/epoint/callback";

export type CsrfRequestLike = { method: string; headers: Headers; url: string };
export type CsrfEnvironment = { production: boolean; appBaseUrl: string | undefined };

function defaultEnvironment(): CsrfEnvironment {
  return { production: process.env.NODE_ENV === "production", appBaseUrl: process.env.APP_BASE_URL };
}

function hostnameOf(host: string) {
  const trimmed = host.trim().toLowerCase();
  if (LOCAL_HOSTNAMES.has(trimmed)) return trimmed;
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(0, end + 1);
  }
  const colon = trimmed.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(trimmed.slice(colon + 1))) return trimmed.slice(0, colon);
  return trimmed;
}

function isPrivateIpv4(name: string) {
  const parts = name.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = parts.map(Number);
  if (first === 10 || first === 127) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 169 && second === 254) return true;
  return false;
}

/** Public dotted hosts stay HTTPS-only in production. Local machine names and private addresses may use HTTP. */
function allowsInsecureHttp(host: string, production: boolean) {
  if (!production) return true;
  const name = hostnameOf(host);
  if (!name) return false;
  if (LOCAL_HOSTNAMES.has(name) || isPrivateIpv4(name)) return true;
  return !name.includes(".");
}

function originParts(value: string | null) {
  if (value === null) return { present: false, scheme: null as string | null, host: null as string | null };
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return { present: true, scheme: "opaque", host: null };
  try {
    const url = new URL(trimmed);
    return { present: true, scheme: url.protocol.replace(/:$/, ""), host: url.host };
  } catch {
    return { present: true, scheme: "invalid", host: null };
  }
}

function requestPath(url: string) {
  try { return new URL(url).pathname; } catch { return "unparsed"; }
}

/** Origins a browser may legitimately send for this request. */
export function trustedOrigins(request: CsrfRequestLike, env: CsrfEnvironment = defaultEnvironment()) {
  const origins = new Set<string>();
  if (env.appBaseUrl?.trim()) {
    try { origins.add(new URL(env.appBaseUrl.trim()).origin.toLowerCase()); } catch { /* A bad base URL never widens trust. */ }
  }
  const hosts = new Set<string>();
  const hostHeader = request.headers.get("host")?.trim().toLowerCase();
  if (hostHeader) hosts.add(hostHeader);
  else {
    try { hosts.add(new URL(request.url).host.toLowerCase()); } catch { /* Relative or malformed URL. */ }
  }
  for (const host of hosts) {
    if (!host || /[\s/\\@]/.test(host)) continue;
    origins.add(`https://${host}`);
    if (allowsInsecureHttp(host, env.production)) origins.add(`http://${host}`);
  }
  if (origins.has("https://shopbagati.com")) origins.add("https://www.shopbagati.com");
  return origins;
}

/** A short machine-readable reason when the request must be treated as cross-site, otherwise null. */
export function crossSiteRequestReason(request: CsrfRequestLike, env: CsrfEnvironment = defaultEnvironment()) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "cross-site") return "fetch-metadata";
  const trusted = trustedOrigins(request, env);
  const origin = request.headers.get("origin");
  if (origin !== null) {
    const normalized = origin.trim().toLowerCase();
    if (!normalized || normalized === "null") return "origin-opaque";
    return trusted.has(normalized) ? null : "origin-mismatch";
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return trusted.has(new URL(referer).origin.toLowerCase()) ? null : "referer-mismatch";
    } catch {
      return "referer-invalid";
    }
  }
  return "origin-absent";
}

function logCrossSiteRejection(request: CsrfRequestLike, reason: string, env: CsrfEnvironment) {
  const origin = originParts(request.headers.get("origin"));
  const referer = originParts(request.headers.get("referer"));
  console.error("Cross-site request rejected.", {
    route: requestPath(request.url),
    method: request.method.toUpperCase(),
    reason,
    originPresent: origin.present,
    originScheme: origin.scheme,
    originHost: origin.host,
    refererPresent: referer.present,
    refererScheme: referer.scheme,
    refererHost: referer.host,
    production: env.production,
  });
}

export function isCsrfExemptApiPath(pathname: string) {
  return pathname === EPOINT_CALLBACK_PATH || EXEMPT_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

/** JSON 403 for cross-site requests, or null when the request may proceed. */
export function csrfRejection(request: CsrfRequestLike, env: CsrfEnvironment = defaultEnvironment()) {
  const reason = crossSiteRequestReason(request, env);
  if (!reason) return null;
  logCrossSiteRejection(request, reason, env);
  return NextResponse.json(
    { error: "Sorğu mənşəyi yoxlanılmadı.", code: "CROSS_SITE_REQUEST" },
    { status: 403, headers: { "Cache-Control": "no-store", Vary: "Origin" } },
  );
}
