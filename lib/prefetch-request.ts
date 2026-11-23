/**
 * GOOGLE-PREFETCH-1: true for requests that are not a person's click, i.e. a prefetch or a Next.js client-router
 * (RSC) fetch:
 * - `Next-Router-Prefetch` / `Next-Router-Segment-Prefetch`: the Next.js router prefetching a <Link>;
 * - `RSC: 1`: the Next.js router fetching a route for a client-side navigation (it falls back to a normal browser
 *   navigation when the answer is not an RSC payload, so refusing it cannot break a click);
 * - `Sec-Purpose: prefetch` / `Purpose: prefetch`: browser prefetch / prerender (speculation rules, link rel=prefetch).
 *
 * A real click on a plain <a> (a top-level browser navigation) sends none of these.
 */
export function isPrefetchOrRouterRequest(headers: Headers): boolean {
  if (headers.has("next-router-prefetch") || headers.has("next-router-segment-prefetch")) return true;
  if (headers.get("rsc") === "1") return true;
  const purpose = `${headers.get("sec-purpose") ?? ""},${headers.get("purpose") ?? ""}`.toLowerCase();
  return /(^|[\s,;])(prefetch|prerender)\b/.test(purpose);
}
