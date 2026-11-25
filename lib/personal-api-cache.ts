/**
 * SECURITY-AUDIT-1 (L-cache): JSON answers of these API routes are always about the signed-in person (their cart,
 * orders, addresses, profile, returns, messages, or their store in the seller panel). The middleware marks them
 * `Cache-Control: private, no-store` so no shared cache (CDN, proxy) or browser history can keep a copy.
 * Header only: the body and status of every response are unchanged. Public catalog APIs (/api/products, /api/stores,
 * /api/categories, ...) are not in this list.
 */
export const PERSONAL_API_PREFIXES = ["/api/cart", "/api/orders", "/api/account", "/api/vendor"] as const;
export const PERSONAL_API_CACHE_CONTROL = "private, no-store";

export function isPersonalApiPath(pathname: string): boolean {
  return PERSONAL_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
