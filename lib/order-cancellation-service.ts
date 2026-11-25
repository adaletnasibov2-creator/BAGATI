/**
 * Customer order cancellation (rules in lib/order-cancellation.ts). Every operation runs in one transaction that first
 * locks the parent Order row (SELECT ... FOR UPDATE), the same lock the seller, admin, shipment and checkout paths take,
 * then re-reads the order and re-checks the rule. So a double click, a store dispatching at the same moment, or two
 * tabs cannot both succeed, and stock is restored at most once (the store cancel transition is a compare-and-set).
 *
 * Payments: a direct cancel marks open PENDING payments FAILED. Nothing here refunds money; a cancelled store order of a
 * paid order is shown as "refund pending (manual)" (refundNeeded).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { cancelStoreOrderLocked } from "@/lib/order-fulfillment";
import {
  canCancelOrderDirectly,
  canRequestStoreOrderCancellation,
  CANCELLATION_REASON_MAX,
  CANCELLATION_RESPONSE_MAX,
  isOrderPaid,
  isStoreOrderDispatched,
  type CancellationOrder,
} from "@/lib/order-cancellation";
import { enqueueEmail } from "@/lib/email-outbox";
import { VENDOR_NOTIFICATION_TITLES } from "@/lib/vendor-notifications";

type Db = Pick<PrismaClient, "$transaction">;
type Tx = Prisma.TransactionClient;

export class OrderCancellationError extends Error {
  constructor(readonly code:
    | "NOT_FOUND"
    | "NOT_ALLOWED" // the rule does not allow this action in the order's current state
    | "REQUEST_OPEN" // a request is already open for this store order
    | "REQUEST_NOT_OPEN" // the request was decided or withdrawn meanwhile
    | "INVALID") {
    super(code);
    this.name = "OrderCancellationError";
  }
}

const shortRef = (id: string) => id.slice(-8).toUpperCase();

async function lockOrder(tx: Tx, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
}

/** Order with what the rules need, plus the people to notify. Only the owner's order is ever returned. */
async function loadOrder(tx: Tx, orderId: string, customerId: string) {
  const order = await tx.order.findFirst({
    where: { id: orderId, userId: customerId },
    select: {
      id: true, status: true,
      user: { select: { email: true } },
      payments: { select: { id: true, status: true } },
      storeOrders: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, storeId: true, status: true, shipmentStatus: true,
          store: { select: { name: true, vendor: { select: { user: { select: { id: true, email: true } } } } } },
          cancellationRequests: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true } },
        },
      },
    },
  });
  if (!order) return null;
  const rules: CancellationOrder = {
    status: order.status,
    payments: order.payments,
    storeOrders: order.storeOrders.map((row) => ({ id: row.id, status: row.status, shipmentStatus: row.shipmentStatus, latestRequestStatus: row.cancellationRequests[0]?.status ?? null })),
  };
  return { order, rules };
}

/** Rule 1: cancel the whole order. */
export async function cancelOrderByCustomer(db: Db, input: { orderId: string; customerId: string }) {
  return db.$transaction(async (tx) => {
    const exists = await tx.order.findFirst({ where: { id: input.orderId, userId: input.customerId }, select: { id: true } });
    if (!exists) throw new OrderCancellationError("NOT_FOUND");
    await lockOrder(tx, input.orderId);
    const loaded = await loadOrder(tx, input.orderId, input.customerId);
    if (!loaded) throw new OrderCancellationError("NOT_FOUND");
    const { order, rules } = loaded;
    if (!canCancelOrderDirectly(rules)) throw new OrderCancellationError("NOT_ALLOWED");

    const cancelled: string[] = [];
    for (const storeOrder of order.storeOrders) {
      if (storeOrder.status === "CANCELLED" || storeOrder.status === "RETURNED") continue;
      await cancelStoreOrderLocked(tx, { id: storeOrder.id, storeId: storeOrder.storeId, actorUserId: input.customerId, source: "CUSTOMER_CANCEL" });
      cancelled.push(storeOrder.id);
    }
    // Open payment attempts end here; a payment the provider still confirms later is recorded for a manual refund.
    const failed = await tx.payment.updateMany({ where: { orderId: order.id, status: "PENDING" }, data: { status: "FAILED" } });

    await tx.auditLog.create({ data: {
      actorId: input.customerId, action: "ORDER_CANCELLED_BY_CUSTOMER", entityType: "Order", entityId: order.id,
      metadata: { storeOrderIds: cancelled, pendingPaymentsFailed: failed.count },
    } });
    await enqueueEmail(tx, { eventKey: `customer-cancel:${order.id}:customer`, recipient: order.user.email, template: "ORDER_STATUS", payload: { orderRef: order.id, storeName: "BAGATI", status: "CANCELLED" } });
    for (const storeOrder of order.storeOrders.filter((row) => cancelled.includes(row.id))) {
      const seller = storeOrder.store.vendor?.user;
      if (!seller) continue;
      await enqueueEmail(tx, { eventKey: `customer-cancel:${storeOrder.id}:seller`, recipient: seller.email, template: "SELLER_ORDER_CANCELLED", payload: { storeName: storeOrder.store.name, orderRef: order.id, storeOrderRef: storeOrder.id } });
      await tx.notification.create({ data: {
        userId: seller.id, storeId: storeOrder.storeId, title: VENDOR_NOTIFICATION_TITLES.orderCancelledByCustomer,
        body: `Sifariş #${shortRef(order.id)} müştəri tərəfindən ləğv edildi. Stok avtomatik bərpa edildi; sifarişi göndərməyin.`,
      } });
    }
    return { orderId: order.id, cancelledStoreOrderIds: cancelled, pendingPaymentsFailed: failed.count };
  });
}

/** Rule 2: the customer asks the store to cancel one store order. */
export async function requestStoreOrderCancellation(db: Db, input: { orderId: string; storeOrderId: string; customerId: string; reason: string }) {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > CANCELLATION_REASON_MAX) throw new OrderCancellationError("INVALID");
  return db.$transaction(async (tx) => {
    const exists = await tx.order.findFirst({ where: { id: input.orderId, userId: input.customerId }, select: { id: true } });
    if (!exists) throw new OrderCancellationError("NOT_FOUND");
    await lockOrder(tx, input.orderId);
    const loaded = await loadOrder(tx, input.orderId, input.customerId);
    if (!loaded) throw new OrderCancellationError("NOT_FOUND");
    const { order, rules } = loaded;
    const storeOrder = order.storeOrders.find((row) => row.id === input.storeOrderId);
    if (!storeOrder) throw new OrderCancellationError("NOT_FOUND");
    if (storeOrder.cancellationRequests[0]?.status === "REQUESTED") throw new OrderCancellationError("REQUEST_OPEN");
    if (!canRequestStoreOrderCancellation(rules, storeOrder.id)) throw new OrderCancellationError("NOT_ALLOWED");

    const request = await tx.orderCancellationRequest.create({
      data: { storeOrderId: storeOrder.id, customerId: input.customerId, reason },
      select: { id: true, status: true, createdAt: true },
    });
    await tx.auditLog.create({ data: {
      actorId: input.customerId, action: "ORDER_CANCELLATION_REQUESTED", entityType: "StoreOrder", entityId: storeOrder.id,
      metadata: { orderId: order.id, requestId: request.id, storeOrderStatus: storeOrder.status, paid: isOrderPaid(rules) },
    } });
    const seller = storeOrder.store.vendor?.user;
    if (seller) {
      await enqueueEmail(tx, { eventKey: `cancellation-request:${request.id}:seller`, recipient: seller.email, template: "SELLER_CANCELLATION_REQUEST", payload: { storeName: storeOrder.store.name, orderRef: order.id, storeOrderRef: storeOrder.id, reason } });
      await tx.notification.create({ data: {
        userId: seller.id, storeId: storeOrder.storeId, title: VENDOR_NOTIFICATION_TITLES.cancellationRequest,
        body: `Sifariş #${shortRef(order.id)} üçün müştəri ləğv istəyir. Müraciət açıq olduğu müddətdə sifariş kuryerə verilə bilməz.`,
      } });
    }
    return request;
  });
}

/** The customer withdraws their open request. */
export async function withdrawStoreOrderCancellation(db: Db, input: { orderId: string; requestId: string; customerId: string }) {
  return db.$transaction(async (tx) => {
    const request = await tx.orderCancellationRequest.findFirst({
      where: { id: input.requestId, customerId: input.customerId, storeOrder: { orderId: input.orderId } },
      select: { id: true, storeOrderId: true, storeOrder: { select: { storeId: true, store: { select: { vendor: { select: { user: { select: { id: true } } } } } } } } },
    });
    if (!request) throw new OrderCancellationError("NOT_FOUND");
    await lockOrder(tx, input.orderId);
    const changed = await tx.orderCancellationRequest.updateMany({ where: { id: request.id, status: "REQUESTED" }, data: { status: "WITHDRAWN" } });
    if (changed.count !== 1) throw new OrderCancellationError("REQUEST_NOT_OPEN");
    await tx.auditLog.create({ data: { actorId: input.customerId, action: "ORDER_CANCELLATION_WITHDRAWN", entityType: "StoreOrder", entityId: request.storeOrderId, metadata: { orderId: input.orderId, requestId: request.id } } });
    const sellerId = request.storeOrder.store.vendor?.user?.id;
    if (sellerId) await tx.notification.create({ data: { userId: sellerId, storeId: request.storeOrder.storeId, title: VENDOR_NOTIFICATION_TITLES.cancellationRequestWithdrawn, body: `Sifariş #${shortRef(input.orderId)} üçün ləğv müraciəti müştəri tərəfindən geri götürüldü.` } });
    return { id: request.id, status: "WITHDRAWN" as const };
  });
}

/**
 * The store decides an open request. Approve = the store's own cancel (stock restored once, open request approved by the
 * transition); the payment is left as it is (manual refund when paid). Reject = the order continues.
 */
export async function decideStoreOrderCancellation(db: Db, input: { storeId: string; requestId: string; actorUserId: string; decision: "APPROVE" | "REJECT"; response?: string | null }) {
  const response = input.response?.trim() || null;
  if (response && response.length > CANCELLATION_RESPONSE_MAX) throw new OrderCancellationError("INVALID");
  if (input.decision === "REJECT" && !response) throw new OrderCancellationError("INVALID");
  return db.$transaction(async (tx) => {
    const request = await tx.orderCancellationRequest.findFirst({
      where: { id: input.requestId, storeOrder: { storeId: input.storeId } },
      select: { id: true, storeOrderId: true, storeOrder: { select: { orderId: true } } },
    });
    if (!request) throw new OrderCancellationError("NOT_FOUND");
    await lockOrder(tx, request.storeOrder.orderId);
    const current = await tx.orderCancellationRequest.findUnique({ where: { id: request.id }, select: { status: true } });
    if (current?.status !== "REQUESTED") throw new OrderCancellationError("REQUEST_NOT_OPEN");
    const storeOrder = await tx.storeOrder.findUnique({
      where: { id: request.storeOrderId },
      select: { id: true, storeId: true, status: true, shipmentStatus: true, store: { select: { name: true } }, order: { select: { id: true, user: { select: { email: true } }, payments: { select: { status: true } } } } },
    });
    if (!storeOrder || storeOrder.storeId !== input.storeId) throw new OrderCancellationError("NOT_FOUND");
    const now = new Date();

    if (input.decision === "APPROVE") {
      // Cannot be dispatched (dispatch is refused while the request is open), but re-check rather than assume.
      if (isStoreOrderDispatched(storeOrder)) throw new OrderCancellationError("NOT_ALLOWED");
      await cancelStoreOrderLocked(tx, { id: storeOrder.id, storeId: input.storeId, actorUserId: input.actorUserId, source: "STORE_APPROVED_CANCEL_REQUEST" });
      await tx.orderCancellationRequest.update({ where: { id: request.id }, data: { status: "APPROVED", storeResponse: response, decidedById: input.actorUserId, decidedAt: now } });
    } else {
      const changed = await tx.orderCancellationRequest.updateMany({ where: { id: request.id, status: "REQUESTED" }, data: { status: "REJECTED", storeResponse: response, decidedById: input.actorUserId, decidedAt: now } });
      if (changed.count !== 1) throw new OrderCancellationError("REQUEST_NOT_OPEN");
    }
    const paid = storeOrder.order.payments.some((payment) => payment.status === "PAID");
    const status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    await tx.auditLog.create({ data: {
      actorId: input.actorUserId, action: `ORDER_CANCELLATION_${status}`, entityType: "StoreOrder", entityId: storeOrder.id,
      metadata: { orderId: storeOrder.order.id, requestId: request.id, paid, refund: input.decision === "APPROVE" && paid ? "pending_manual" : null },
    } });
    await enqueueEmail(tx, { eventKey: `cancellation-decision:${request.id}`, recipient: storeOrder.order.user.email, template: "CANCELLATION_REQUEST_DECISION", payload: { orderRef: storeOrder.order.id, storeName: storeOrder.store.name, decision: status, response: response ?? "", paid: String(paid) } });
    return { id: request.id, status, refundPendingManual: input.decision === "APPROVE" && paid };
  });
}
