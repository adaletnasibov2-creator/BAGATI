import { aggregateParentOrderStatus, allowedVendorOrderTransitions, VENDOR_ORDER_STATUSES } from "@/lib/order-status";
import { approveOpenRequestsOnStoreCancel, hasOpenCancellationRequest, isDispatchOrderStatus } from "@/lib/order-cancellation-guard";
import { queueOrderProgressEmail, type StatusChangeSource } from "@/lib/order-progress-emails";

type Transaction = any;
type StoreOrderStatus = (typeof VENDOR_ORDER_STATUSES)[number];

export function allowedAdminOrderTransitions(storeOrderStatuses: readonly string[]) {
  return VENDOR_ORDER_STATUSES.filter((target) =>
    storeOrderStatuses.length > 0 && storeOrderStatuses.every((status) => allowedVendorOrderTransitions(status).includes(target)),
  );
}

export class OrderFulfillmentError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "INVALID_TRANSITION" | "PAYMENT_NOT_SETTLED" | "CONFLICT" | "NO_STORE_ORDERS" | "CANCELLATION_REQUEST_OPEN") {
    super(code);
  }
}

export function validateOrderStatusTransition(
  currentStatus: string,
  targetStatus: string,
  paymentStatuses: readonly string[],
) {
  if (!allowedVendorOrderTransitions(currentStatus).includes(targetStatus)) return "INVALID_TRANSITION" as const;
  if (targetStatus === "DELIVERED" && !paymentStatuses.includes("PAID")) {
    return "PAYMENT_NOT_SETTLED" as const;
  }
  return null;
}

async function restoreCancelledStoreOrderInventory(
  tx: Transaction,
  storeOrderId: string,
  storeId: string,
  actorUserId: string,
) {
  const items = await tx.orderItem.findMany({
    where: { storeOrderId },
    include: { product: { select: { storeId: true, variants: { select: { id: true } } } } },
  });
  let skippedLegacyVariantItems = 0;
  const lines: { item: { quantity: number }; inventoryId: string }[] = [];
  for (const item of items) {
    if (item.product.storeId !== storeId) continue;
    // Legacy order lines may not identify a variant. Do not guess which stock row to restore.
    if (!item.variantId && item.product.variants.length) {
      skippedLegacyVariantItems++;
      continue;
    }
    const inventory = await tx.inventory.findFirst({ where: { productId: item.productId, variantId: item.variantId } });
    if (!inventory) continue;
    lines.push({ item, inventoryId: inventory.id });
  }
  // Lock the stock rows in inventory-id order, the same order checkout uses (app/api/orders/route.ts), so two cancels
  // (or a cancel and a checkout) sharing products cannot deadlock (SCALE-FIX-4). The restore itself is unchanged.
  lines.sort((a, b) => a.inventoryId.localeCompare(b.inventoryId));
  for (const { item, inventoryId } of lines) {
    const inventory = { id: inventoryId };
    await tx.$queryRaw`SELECT "id" FROM "Inventory" WHERE "id" = ${inventory.id} FOR UPDATE`;
    const current = await tx.inventory.findUnique({ where: { id: inventory.id } });
    if (!current) continue;
    const updated = await tx.inventory.update({ where: { id: current.id }, data: { quantity: { increment: item.quantity } } });
    await tx.inventoryAdjustment.create({ data: {
      inventoryId: current.id,
      actorUserId,
      delta: item.quantity,
      previousQuantity: current.quantity,
      newQuantity: updated.quantity,
      reason: `Sifariş ${storeOrderId} ləğv edildiyi üçün stok bərpa edildi`,
    } });
  }
  return skippedLegacyVariantItems;
}

async function applyStoreOrderTransition(
  tx: Transaction,
  input: { id: string; storeId: string; actorUserId: string; targetStatus: StoreOrderStatus; source: StatusChangeSource; extraData?: Record<string, unknown> },
) {
  const storeOrder = await tx.storeOrder.findFirst({
    where: { id: input.id, storeId: input.storeId },
    include: { order: { select: { id: true, payments: { select: { status: true } } } } },
  });
  if (!storeOrder) throw new OrderFulfillmentError("NOT_FOUND");
  const paymentStatuses = storeOrder.order.payments.map((payment: { status: string }) => payment.status);
  const validation = validateOrderStatusTransition(storeOrder.status, input.targetStatus, paymentStatuses);
  if (validation) throw new OrderFulfillmentError(validation);
  // A customer's open cancellation request must be decided before the order leaves the store.
  if (isDispatchOrderStatus(input.targetStatus) && await hasOpenCancellationRequest(tx, storeOrder.id)) {
    throw new OrderFulfillmentError("CANCELLATION_REQUEST_OPEN");
  }

  const updated = await tx.storeOrder.updateMany({
    where: { id: storeOrder.id, storeId: input.storeId, status: storeOrder.status },
    data: { ...input.extraData, status: input.targetStatus },
  });
  if (updated.count !== 1) throw new OrderFulfillmentError("CONFLICT");
  // ORDER-NOTIFY-1: the one hook for the customer's progress e-mail (same transaction; never throws, never blocks).
  await queueOrderProgressEmail(tx, { storeOrderId: storeOrder.id, fromStatus: storeOrder.status, targetStatus: input.targetStatus, source: input.source });

  const skippedLegacyVariantItems = input.targetStatus === "CANCELLED"
    ? await restoreCancelledStoreOrderInventory(tx, storeOrder.id, input.storeId, input.actorUserId)
    : 0;
  if (input.targetStatus === "CANCELLED") await approveOpenRequestsOnStoreCancel(tx, storeOrder.id, input.actorUserId);
  const children = await tx.storeOrder.findMany({ where: { orderId: storeOrder.orderId }, select: { status: true } });
  await tx.order.update({ where: { id: storeOrder.orderId }, data: { status: aggregateParentOrderStatus(children.map((child: { status: string }) => child.status)) } });
  const item = await tx.storeOrder.findUnique({ where: { id: storeOrder.id }, include: { items: true } });
  return {
    item,
    warning: skippedLegacyVariantItems
      ? `${skippedLegacyVariantItems} köhnə məhsulun variantı bilinmədiyi üçün stok avtomatik bərpa edilmədi.`
      : undefined,
  };
}

export async function transitionVendorStoreOrder(
  tx: Transaction,
  input: { id: string; storeId: string; actorUserId: string; targetStatus: StoreOrderStatus; extraData?: Record<string, unknown> },
) {
  const existing = await tx.storeOrder.findFirst({ where: { id: input.id, storeId: input.storeId }, select: { orderId: true } });
  if (!existing) throw new OrderFulfillmentError("NOT_FOUND");
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${existing.orderId} FOR UPDATE`;
  return applyStoreOrderTransition(tx, { ...input, source: "STORE" });
}

/**
 * Cancel one store order with the store's own cancel transition (compare-and-set on the status, stock restored once,
 * parent status recomputed, open requests approved). Used by the customer's direct cancel and by the store's approval of
 * a cancellation request. The caller must already hold the parent Order row lock.
 */
export async function cancelStoreOrderLocked(tx: Transaction, input: { id: string; storeId: string; actorUserId: string; source: "CUSTOMER_CANCEL" | "STORE_APPROVED_CANCEL_REQUEST" | "UNPAID_EXPIRY" }) {
  return applyStoreOrderTransition(tx, { ...input, targetStatus: "CANCELLED" });
}

export async function transitionAdminOrder(
  tx: Transaction,
  input: { orderId: string; actorUserId: string; targetStatus: StoreOrderStatus },
) {
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`;
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    include: { payments: { select: { status: true } }, storeOrders: { select: { id: true, storeId: true, status: true } } },
  });
  if (!order) throw new OrderFulfillmentError("NOT_FOUND");
  if (!order.storeOrders.length) throw new OrderFulfillmentError("NO_STORE_ORDERS");

  const paymentStatuses = order.payments.map((payment: { status: string }) => payment.status);
  for (const child of order.storeOrders) {
    const validation = validateOrderStatusTransition(child.status, input.targetStatus, paymentStatuses);
    if (validation) throw new OrderFulfillmentError(validation);
  }

  for (const child of order.storeOrders) {
    await applyStoreOrderTransition(tx, {
      id: child.id,
      storeId: child.storeId,
      actorUserId: input.actorUserId,
      targetStatus: input.targetStatus,
      source: "ADMIN",
    });
  }
  return tx.order.findUnique({ where: { id: input.orderId } });
}
