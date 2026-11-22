/**
 * What POST /api/orders sends back to the customer's browser (SMALL-FIXES-1 A).
 *
 * The order is created with seller data included (the seller's account email is needed server-side for the seller
 * emails queued after the commit). That data must never reach the customer, so the response is built from an
 * explicit allow-list instead of returning the created object. The checkout only reads `order.id`
 * (components/checkout-form.tsx: redirect to /orders/{id}, or the Epoint initiate call); the order page loads its
 * own data on the server.
 */
export type OrderCreateResponse = { order: { id: string } };

export function orderCreateResponse(order: { id: string }): OrderCreateResponse {
  return { order: { id: order.id } };
}

/**
 * The `code` POST /api/orders may send back on an error (SEC-FIX-1 L4): one of the route's own known codes, otherwise
 * "ERROR". An unexpected error's message (for example a database error with table or column names) never reaches the
 * browser. Own keys only, so "constructor" and other prototype names are not "known".
 */
export function publicOrderErrorCode(code: string, knownMessages: Record<string, string>): string {
  return Object.prototype.hasOwnProperty.call(knownMessages, code) ? code : "ERROR";
}
