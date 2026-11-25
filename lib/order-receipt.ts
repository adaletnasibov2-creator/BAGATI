/**
 * ORDER-NOTIFY-1: the customer's "Təhvil aldım" (received) confirmation for ONE store order.
 *
 * Rules:
 * - only the customer who owns the order; any other order or account reads as NOT_FOUND (404, nothing revealed);
 * - only while the store order is HANDED_TO_COURIER, SHIPPED or DELIVERED and its shipment was not RETURNED;
 * - idempotent: the first confirmation sets `customerConfirmedAt` with a compare-and-set (only while it is null);
 *   a second one returns the stored time and creates nothing;
 * - it NEVER changes the order status, the shipment status, payment, stock or finance.
 * On the first confirmation, in the same transaction: one audit row (ORDER_RECEIPT_CONFIRMED) and one seller in-app
 * notification. After the commit, best effort: a short e-mail to the seller's addresses (the same recipients as the
 * new-order e-mail), deduped per store order and address. A failing e-mail never undoes the confirmation.
 */
import type { PrismaClient } from "@prisma/client";
import { absoluteSiteUrl } from "@/lib/category-seo";
import { enqueueEmail } from "@/lib/email-outbox";
import { ORDER_NOTIFY_TEXT } from "@/lib/order-notify-text";
import { sellerOrderNumber, sellerOrderRecipients } from "@/lib/seller-order-emails";

export const RECEIPT_ALLOWED_STATUSES = ["HANDED_TO_COURIER", "SHIPPED", "DELIVERED"] as const;

/** Whether the customer may confirm receipt of this store order now (status rules only). */
export function receiptAllowed(storeOrder: { status: string; shipmentStatus?: string | null }): boolean {
  return (RECEIPT_ALLOWED_STATUSES as readonly string[]).includes(storeOrder.status) && storeOrder.shipmentStatus !== "RETURNED";
}

export class OrderReceiptError extends Error {
  constructor(readonly code: "NOT_FOUND" | "NOT_ALLOWED") { super(code); this.name = "OrderReceiptError"; }
}

export type ReceiptResult = { storeOrderId: string; confirmedAt: Date; alreadyConfirmed: boolean };

type ReceiptDb = Pick<PrismaClient, "$transaction" | "emailOutbox" | "store">;
type SellerEmailJob = { storeOrderId: string; storeId: string; orderId: string; storeName: string; accountEmail: string };

export async function confirmStoreOrderReceipt(
  db: ReceiptDb,
  input: { customerId: string; orderId: string; storeOrderId: string; now?: Date },
  deps: { queueSellerEmails?: (job: SellerEmailJob) => Promise<void> } = {},
): Promise<ReceiptResult> {
  let job: SellerEmailJob | null = null;
  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: input.orderId, userId: input.customerId }, select: { id: true } });
    if (!order) throw new OrderReceiptError("NOT_FOUND");
    // The same parent-row lock every status change takes: no confirmation can race a cancel or a status change.
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
    const storeOrder = await tx.storeOrder.findFirst({
      where: { id: input.storeOrderId, orderId: order.id },
      select: { id: true, storeId: true, status: true, shipmentStatus: true, customerConfirmedAt: true, store: { select: { name: true, vendor: { select: { user: { select: { id: true, email: true } } } } } } },
    });
    if (!storeOrder) throw new OrderReceiptError("NOT_FOUND");
    if (storeOrder.customerConfirmedAt) return { storeOrderId: storeOrder.id, confirmedAt: storeOrder.customerConfirmedAt, alreadyConfirmed: true };
    if (!receiptAllowed(storeOrder)) throw new OrderReceiptError("NOT_ALLOWED");
    const confirmedAt = input.now ?? new Date();
    const changed = await tx.storeOrder.updateMany({ where: { id: storeOrder.id, customerConfirmedAt: null }, data: { customerConfirmedAt: confirmedAt } });
    if (changed.count !== 1) {
      const current = await tx.storeOrder.findUnique({ where: { id: storeOrder.id }, select: { customerConfirmedAt: true } });
      if (current?.customerConfirmedAt) return { storeOrderId: storeOrder.id, confirmedAt: current.customerConfirmedAt, alreadyConfirmed: true };
      throw new OrderReceiptError("NOT_FOUND");
    }
    await tx.auditLog.create({ data: {
      actorId: input.customerId, action: "ORDER_RECEIPT_CONFIRMED", entityType: "StoreOrder", entityId: storeOrder.id,
      metadata: { orderId: order.id, storeId: storeOrder.storeId, status: storeOrder.status, shipmentStatus: storeOrder.shipmentStatus },
    } });
    const seller = storeOrder.store.vendor?.user;
    if (seller) {
      await tx.notification.create({ data: {
        userId: seller.id, storeId: storeOrder.storeId, title: ORDER_NOTIFY_TEXT.sellerConfirmed,
        body: ORDER_NOTIFY_TEXT.sellerNotificationBody(sellerOrderNumber(order.id)),
      } });
      job = { storeOrderId: storeOrder.id, storeId: storeOrder.storeId, orderId: order.id, storeName: storeOrder.store.name, accountEmail: seller.email };
    }
    return { storeOrderId: storeOrder.id, confirmedAt, alreadyConfirmed: false };
  });
  if (job) await (deps.queueSellerEmails ?? ((value: SellerEmailJob) => queueSellerReceiptEmails(db, value)))(job);
  return result;
}

/** Best effort, after the commit: never throws; failures are logged as counts only (no addresses). */
export async function queueSellerReceiptEmails(db: Pick<PrismaClient, "emailOutbox" | "store">, job: SellerEmailJob, base: string | undefined = process.env.APP_BASE_URL): Promise<{ queued: number; failed: number }> {
  let queued = 0, failed = 0;
  try {
    const store = await db.store.findUnique({ where: { id: job.storeId }, select: { notificationEmail: true, notificationEmailVerifiedAt: true } }).catch(() => null);
    const payload = {
      storeName: job.storeName.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120),
      orderRef: sellerOrderNumber(job.orderId),
      panelUrl: absoluteSiteUrl(`/vendor/${job.storeId}/orders/${job.storeOrderId}`, base) ?? "",
    };
    for (const recipient of sellerOrderRecipients(job.accountEmail, store)) {
      try {
        await enqueueEmail(db as never, { eventKey: `seller-customer-confirmed:${job.storeOrderId}:${recipient}`, recipient, template: "SELLER_CUSTOMER_CONFIRMED", payload });
        queued += 1;
      } catch {
        failed += 1;
      }
    }
  } catch {
    failed += 1;
  }
  if (failed) console.error(JSON.stringify({ event: "seller_receipt_email.queue_failed", storeOrderId: job.storeOrderId, queued, failed }));
  return { queued, failed };
}
