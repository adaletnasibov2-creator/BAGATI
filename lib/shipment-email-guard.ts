import { SHIPMENT_EMAIL_ORDER_LIMIT, SHIPMENT_EMAIL_STORE_LIMIT, withinFormRateLimits, type FormRateLimitDeps } from "@/lib/form-rate-limit";
import { shipmentChangeAllowedForOrder } from "@/lib/shipment-tracking";

/**
 * SEC-FIX-2 (L5): whether a seller's tracking change may e-mail the customer. The recipient is decided by the caller
 * (always the order's own customer); this decides whether to send at all:
 * - never for a closed order (CANCELLED / RETURNED, the same rule that already blocks shipment-status changes);
 * - at most 10 per store order per 24 h and 200 per store per hour (DB-backed), so changing the tracking code or link
 *   again and again cannot flood a customer. The tracking data itself is still saved; only the extra e-mail is skipped.
 * If the rate-limit store fails, the e-mail is allowed and the failure logged (see withinFormRateLimits).
 */
export async function shipmentEmailAllowed(input: { storeId: string; storeOrderId: string; orderStatus: string }, deps?: FormRateLimitDeps): Promise<boolean> {
  if (!shipmentChangeAllowedForOrder(input.orderStatus)) return false;
  return withinFormRateLimits([
    { scope: "shipment-email", identity: `store-order:${input.storeOrderId}`, ...SHIPMENT_EMAIL_ORDER_LIMIT },
    { scope: "shipment-email", identity: `store:${input.storeId}`, ...SHIPMENT_EMAIL_STORE_LIMIT },
  ], "shipment_email_rate_limit", deps);
}
