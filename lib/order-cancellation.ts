/**
 * Customer order cancellation rules (owner decisions 2026-11-16). Pure functions, used by the API routes (which re-check
 * them inside the locking transaction) and by the order page (which decides what to show).
 *
 * 1. Direct cancel (whole order): no payment is PAID, no store order has been dispatched, and every store order that is
 *    still open is NEW/PENDING (no store has CONFIRMED or started PREPARING). Stock is restored; open PENDING payments
 *    become FAILED.
 * 2. Otherwise, per store order that is not dispatched and still open: the customer sends a cancellation request and the
 *    store decides. Refunds are not automated: an approved request on a paid order shows "refund pending (manual)".
 * 3. Dispatched (by the store order status OR by the separate shipment status): no cancel; returns after delivery.
 */

export const DISPATCHED_ORDER_STATUSES = ["HANDED_TO_COURIER", "SHIPPED", "DELIVERED", "RETURNED"] as const;
export const DISPATCHED_SHIPMENT_STATUSES = ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "RETURNED"] as const;
const NOT_YET_CONFIRMED = ["NEW", "PENDING"];
const CLOSED_STATUSES = ["CANCELLED", "RETURNED"];

export type CancellationStoreOrder = {
  id: string;
  status: string;
  shipmentStatus: string | null;
  /** Status of the newest cancellation request for this store order, if any. */
  latestRequestStatus?: string | null;
};
export type CancellationOrder = { status: string; payments: { status: string }[]; storeOrders: CancellationStoreOrder[] };

/** Dispatched by either signal: the store order status or the (independent) shipment status. */
export function isStoreOrderDispatched(storeOrder: Pick<CancellationStoreOrder, "status" | "shipmentStatus">): boolean {
  return (DISPATCHED_ORDER_STATUSES as readonly string[]).includes(storeOrder.status)
    || (storeOrder.shipmentStatus !== null && (DISPATCHED_SHIPMENT_STATUSES as readonly string[]).includes(storeOrder.shipmentStatus));
}

export function isOrderPaid(order: Pick<CancellationOrder, "payments">): boolean {
  return order.payments.some((payment) => payment.status === "PAID");
}

export type StoreOrderCancellationState =
  | "REQUEST" // the customer may send a cancellation request
  | "REQUESTED" // a request is open; the store decides
  | "IN_TRANSIT" // dispatched, not delivered: no cancel, returns after delivery
  | "DELIVERED" // delivered: the returns flow applies
  | "CLOSED"; // cancelled or returned

export type OrderCancellationView = {
  /** Rule 1: the whole order can be cancelled at once. */
  direct: boolean;
  storeOrders: { id: string; state: StoreOrderCancellationState; lastRequestRejected: boolean }[];
};

export function storeOrderCancellationState(storeOrder: CancellationStoreOrder): StoreOrderCancellationState {
  if (CLOSED_STATUSES.includes(storeOrder.status)) return "CLOSED";
  if (storeOrder.status === "DELIVERED" || storeOrder.shipmentStatus === "DELIVERED") return "DELIVERED";
  if (isStoreOrderDispatched(storeOrder)) return "IN_TRANSIT";
  if (storeOrder.latestRequestStatus === "REQUESTED") return "REQUESTED";
  return "REQUEST";
}

export function canCancelOrderDirectly(order: CancellationOrder): boolean {
  if (isOrderPaid(order)) return false;
  const open = order.storeOrders.filter((storeOrder) => !CLOSED_STATUSES.includes(storeOrder.status));
  if (!open.length) return false;
  return open.every((storeOrder) =>
    NOT_YET_CONFIRMED.includes(storeOrder.status)
    && !isStoreOrderDispatched(storeOrder)
    && storeOrder.latestRequestStatus !== "REQUESTED");
}

export function orderCancellationView(order: CancellationOrder): OrderCancellationView {
  return {
    direct: canCancelOrderDirectly(order),
    storeOrders: order.storeOrders.map((storeOrder) => ({
      id: storeOrder.id,
      state: storeOrderCancellationState(storeOrder),
      lastRequestRejected: storeOrder.latestRequestStatus === "REJECTED",
    })),
  };
}

/** A request may be created for this store order now (rule 2), i.e. the direct cancel does not apply to the order. */
export function canRequestStoreOrderCancellation(order: CancellationOrder, storeOrderId: string): boolean {
  if (canCancelOrderDirectly(order)) return false;
  const storeOrder = order.storeOrders.find((row) => row.id === storeOrderId);
  return Boolean(storeOrder) && storeOrderCancellationState(storeOrder!) === "REQUEST";
}

/**
 * A cancelled store order of an order with a PAID payment needs a manual refund: an approved request on a paid order, or
 * a payment that was confirmed after the customer cancelled. Nothing is refunded automatically.
 */
export function refundNeeded(order: Pick<CancellationOrder, "payments">, storeOrder: Pick<CancellationStoreOrder, "status">): boolean {
  return storeOrder.status === "CANCELLED" && isOrderPaid(order);
}

export const CANCELLATION_REASON_MAX = 500;
export const CANCELLATION_RESPONSE_MAX = 1000;

export const CANCELLATION_TEXT = {
  inTransit: "Sifariş yoldadır; çatdırıldıqdan sonra qaytarma müraciəti edə bilərsiniz.",
  delivered: "Sifariş çatdırılıb. Problem olarsa, qaytarma müraciəti göndərə bilərsiniz.",
  requested: "Ləğv müraciətiniz göndərilib. Mağazanın qərarı gözlənilir.",
  rejected: "Mağaza əvvəlki ləğv müraciətinizi rədd edib.",
  refundPending: "Geri ödəniş gözləyir (əl ilə)",
} as const;
