/**
 * Transaction helpers shared by every path that can dispatch or cancel a store order (seller, admin, customer). Callers
 * hold the parent Order row lock (SELECT ... FOR UPDATE), the same lock the cancellation routes take, so a request and a
 * dispatch cannot interleave.
 */
import type { Prisma } from "@prisma/client";
import { DISPATCHED_ORDER_STATUSES, DISPATCHED_SHIPMENT_STATUSES } from "@/lib/order-cancellation";

type Tx = Pick<Prisma.TransactionClient, "orderCancellationRequest">;

export const CANCELLATION_REQUEST_OPEN_MESSAGE = "Bu sifariş üçün açıq ləğv müraciəti var. Əvvəlcə müraciəti təsdiqləyin və ya rədd edin.";

export function isDispatchOrderStatus(status: string): boolean {
  return (DISPATCHED_ORDER_STATUSES as readonly string[]).includes(status);
}

export function isDispatchShipmentStatus(status: string): boolean {
  return (DISPATCHED_SHIPMENT_STATUSES as readonly string[]).includes(status);
}

export async function hasOpenCancellationRequest(tx: Tx, storeOrderId: string): Promise<boolean> {
  return (await tx.orderCancellationRequest.count({ where: { storeOrderId, status: "REQUESTED" } })) > 0;
}

/** The store (or an admin) cancelled the store order itself: an open customer request is thereby approved. */
export async function approveOpenRequestsOnStoreCancel(tx: Tx, storeOrderId: string, actorUserId: string, now = new Date()): Promise<number> {
  const updated = await tx.orderCancellationRequest.updateMany({
    where: { storeOrderId, status: "REQUESTED" },
    data: { status: "APPROVED", decidedById: actorUserId, decidedAt: now },
  });
  return updated.count;
}
