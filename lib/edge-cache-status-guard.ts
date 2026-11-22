/**
 * PERF-1: the guest edge-cache header (lib/edge-cache.ts) may only reach Cloudflare on a normal successful page.
 * Middleware runs before the page, so it cannot know the status. This guard runs where the status IS known: when the
 * response head is written. OUR header (only our value: the maintenance 503's own `no-store` copy is kept unchanged)
 * stays only on a normal page: status 200, Content-Type text/html, and not a Next.js client-navigation request.
 * Everything else loses it: 404 / not found, 500 / error, 3xx redirect, and the RSC data of client navigation
 * (`text/x-component`; Next hides the RSC markers from middleware, so only this layer can see them).
 * It only ever REMOVES, so a failure here can never make anything cacheable.
 *
 * Node.js runtime only (installed from instrumentation.ts). Limit: a page that streams "200" first and fails later
 * (routes with loading.tsx) cannot be caught here; see release-output/perf-1-report.md.
 */
import { ServerResponse } from "node:http";
import { EDGE_CACHE_HEADER, EDGE_CACHE_VALUE } from "./edge-cache";

const HEADER_LOWER = EDGE_CACHE_HEADER.toLowerCase();
const INSTALLED = Symbol.for("bagati.edgeCacheStatusGuard");

type HeadersArg = Record<string, unknown> | unknown[] | undefined;

const RSC_REQUEST_HEADERS = ["rsc", "next-router-prefetch", "next-router-state-tree", "next-router-segment-prefetch"];

/** The header value from an explicit writeHead headers argument (object or raw array form), if given there. */
function headerFromArg(headers: HeadersArg, name: string): unknown {
  if (!headers) return undefined;
  if (Array.isArray(headers)) {
    if (headers.every((entry) => Array.isArray(entry))) return (headers.find((entry) => String((entry as unknown[])[0]).toLowerCase() === name) as unknown[] | undefined)?.[1];
    for (let i = 0; i < headers.length; i += 2) if (String(headers[i]).toLowerCase() === name) return headers[i + 1];
    return undefined;
  }
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
}

type RequestLike = { headers?: Record<string, unknown>; url?: string } | undefined;

/** True only for a normal page: 200, HTML, and not a client-navigation (RSC) request. Pure; exported for tests. */
export function keepsEdgeCacheHeader(statusCode: unknown, contentType: unknown, request: RequestLike): boolean {
  if (statusCode !== 200) return false;
  if (!/^text\/html(;|\s|$)/i.test(String(contentType ?? ""))) return false;
  const headers = request?.headers ?? {};
  if (RSC_REQUEST_HEADERS.some((name) => headers[name] !== undefined)) return false;
  if (/[?&]_rsc=/.test(request?.url ?? "")) return false;
  return true;
}

const isOurs = (name: unknown, value: unknown) => String(name).toLowerCase() === HEADER_LOWER && String(value) === EDGE_CACHE_VALUE;

/** Removes our header from an explicit writeHead(status, [message], headers) argument (object or raw array form). */
export function withoutEdgeCacheHeader(headers: HeadersArg): HeadersArg {
  if (!headers) return headers;
  if (Array.isArray(headers)) {
    // Either [[name, value], ...] or the flat raw form [name, value, name, value, ...].
    if (headers.every((entry) => Array.isArray(entry))) return headers.filter((entry) => !isOurs((entry as unknown[])[0], (entry as unknown[])[1]));
    const out: unknown[] = [];
    for (let i = 0; i < headers.length; i += 2) if (!isOurs(headers[i], headers[i + 1])) out.push(headers[i], headers[i + 1]);
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) if (!isOurs(name, value)) out[name] = value;
  return out;
}

export function installEdgeCacheStatusGuard(proto: typeof ServerResponse.prototype = ServerResponse.prototype): boolean {
  const target = proto as unknown as Record<symbol, unknown> & { writeHead: (...args: unknown[]) => unknown };
  if (target[INSTALLED]) return false;
  const original = target.writeHead;
  target.writeHead = function guardedWriteHead(this: ServerResponse, statusCode: unknown, ...rest: unknown[]) {
    const argHeaders = rest.length && typeof rest[rest.length - 1] !== "string" ? (rest[rest.length - 1] as HeadersArg) : undefined;
    const contentType = headerFromArg(argHeaders, "content-type") ?? this.getHeader("content-type");
    if (!keepsEdgeCacheHeader(statusCode, contentType, this.req as RequestLike)) {
      if (String(this.getHeader(EDGE_CACHE_HEADER)) === EDGE_CACHE_VALUE) this.removeHeader(EDGE_CACHE_HEADER);
      if (rest.length) rest[rest.length - 1] = typeof rest[rest.length - 1] === "string" ? rest[rest.length - 1] : withoutEdgeCacheHeader(rest[rest.length - 1] as HeadersArg);
    }
    return original.call(this, statusCode, ...rest);
  };
  target[INSTALLED] = true;
  return true;
}
