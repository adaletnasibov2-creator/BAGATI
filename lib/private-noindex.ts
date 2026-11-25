/**
 * LAUNCH-TECH-1: private and per-visitor pages answer `X-Robots-Tag: noindex, nofollow` (header, like the admin area),
 * so a search engine that reaches one through a link never lists it. robots.txt (lib/structured-data.ts
 * ROBOTS_DISALLOW) already asks crawlers not to fetch them; this header covers the URL itself.
 * Edge-safe and pure: the middleware calls it for every page request. No visible change.
 */
export const PRIVATE_NOINDEX_PREFIXES = [
  "/account", "/orders", "/cart", "/checkout", "/favorites", "/vendor",
  "/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/auth",
] as const;
export const PRIVATE_X_ROBOTS_TAG = "noindex, nofollow";

export function isPrivateNoindexPath(pathname: string): boolean {
  return PRIVATE_NOINDEX_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
