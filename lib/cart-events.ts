/**
 * DESIGN-POLISH-1: the header cart badge listens for this browser event. Fired after a successful add, quantity change
 * or removal. With `count` (the cart page already has the fresh cart) the badge uses it; without it the badge re-reads
 * the real cart (GET /api/cart). Nothing else listens; the cart logic is unchanged.
 */
export const CART_CHANGED_EVENT = "bagati:cart";

export function notifyCartChanged(count?: number): void {
  try { window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT, { detail: typeof count === "number" ? { count } : {} })); } catch { /* not in a browser */ }
}

/** Number shown on a header badge: nothing for 0 or an invalid value, "99+" above 99. */
export function headerBadgeText(count: number | null | undefined): string | null {
  if (typeof count !== "number" || !Number.isFinite(count) || count < 1) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}
