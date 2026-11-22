/** Most units of one product (or variant) in one cart line: the same 1..50 rule as PATCH /api/cart/items/[itemId]. */
export const CART_LINE_MAX_QUANTITY = 50;

/** SEC-FIX-1 L7: POST /api/cart/items adds to an existing line, so the TOTAL must also stay within 1..50. */
export function cartLineQuantityAllowed(total: number): boolean {
  return Number.isInteger(total) && total >= 1 && total <= CART_LINE_MAX_QUANTITY;
}
