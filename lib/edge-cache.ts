/**
 * PERF-1: guest-only edge-cache header for Cloudflare (PERF-0 option c). Pure and Edge-safe (used by middleware.ts).
 *
 * Cloudflare reads `Cloudflare-CDN-Cache-Control`; browsers never see a cache instruction from it, so the normal
 * `Cache-Control` the browser gets is unchanged. The header is added only for a guest (no `bagati_*` cookie) GET/HEAD
 * of an allow-listed public page without a search query and without any Next.js client-navigation (RSC) marker.
 * Only a normal page keeps it: lib/edge-cache-status-guard.ts removes it when the response head is written unless the
 * status is 200, the type is text/html and it is not a client-navigation (RSC) request.
 * Off switch: PUBLIC_EDGE_CACHE=off (default on).
 */

export const EDGE_CACHE_HEADER = "Cloudflare-CDN-Cache-Control";
export const EDGE_CACHE_VALUE = "public, max-age=60, stale-while-revalidate=60";

/**
 * Exact paths (no trailing slash, case-sensitive, like the Next.js routes).
 * "/" and "/products" are left out on purpose (owner decision, PERF-1): their loading.tsx makes Next send "200" before
 * the page is finished, so a later error could not be kept out of the cache. See release-output/perf-1-report.md.
 */
const EXACT_PATHS = new Set([
  "/categories", "/new-products", "/deals",
  "/about", "/contact", "/help", "/terms", "/privacy", "/delivery-returns", "/seller-terms",
]);

/** One plain id or slug segment: letters, digits, "-" and "_" only (so no "%", ".", "/" or encoded tricks). */
const SEGMENT = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Next.js client navigation / prefetch requests carry these; their RSC payload must never be stored as the page.
 * Note (PERF-1 live check): Next hides these markers (and `_rsc`) from middleware, so this check is only a first
 * layer; the real one is lib/edge-cache-status-guard.ts (keeps the header only on a text/html page).
 */
const RSC_REQUEST_HEADERS = ["rsc", "next-router-prefetch", "next-router-state-tree", "next-router-segment-prefetch", "next-action"];

export function isEdgeCacheEnabled(env: { PUBLIC_EDGE_CACHE?: string }): boolean {
  return (env.PUBLIC_EDGE_CACHE ?? "").trim().toLowerCase() !== "off";
}

export function isEdgeCacheablePath(pathname: string): boolean {
  if (EXACT_PATHS.has(pathname)) return true;
  const parts = pathname.split("/");
  // "/products/<id>" and "/stores/<id or slug>" only: exactly ["", "products"|"stores", segment].
  return parts.length === 3 && parts[0] === "" && (parts[1] === "products" || parts[1] === "stores") && SEGMENT.test(parts[2]) && parts[2] !== "map";
}

/** True when any cookie name starts with "bagati_" (case-insensitive, raw Cookie header). */
export function hasBagatiCookie(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((part) => part.split("=")[0].trim().toLowerCase().startsWith("bagati_"));
}

export type EdgeCacheRequest = {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  headers: { get(name: string): string | null };
};

export function shouldAddEdgeCacheHeader(request: EdgeCacheRequest, env: { PUBLIC_EDGE_CACHE?: string }): boolean {
  if (!isEdgeCacheEnabled(env)) return false;
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (!isEdgeCacheablePath(request.pathname)) return false;
  if (request.searchParams.has("q") || request.searchParams.has("_rsc")) return false;
  if (hasBagatiCookie(request.headers.get("cookie"))) return false;
  if (request.headers.get("authorization") !== null) return false;
  if (RSC_REQUEST_HEADERS.some((name) => request.headers.get(name) !== null)) return false;
  return true;
}
