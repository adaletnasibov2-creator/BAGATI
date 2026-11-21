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
