/**
 * ORDER-NOTIFY-1: the customer's e-mails about one store order's progress. ONE hook, called from the single place
 * every store-order status change goes through (applyStoreOrderTransition in lib/order-fulfillment.ts), inside the
 * same transaction as the status change.
 *
 * Events (per STORE order, so a two-store order gets separate e-mails):
 *   CONFIRMED                    -> "CONFIRMED"
 *   HANDED_TO_COURIER or SHIPPED -> "ON_THE_WAY" (one shared event: only the first of the two sends)
 *   DELIVERED                    -> "DELIVERED"
 *   CANCELLED                    -> "CANCELLED", only when the STORE cancelled it from the seller panel
 * Nothing for PENDING / NEW / PREPARING / READY / PROCESSING / RETURNED.
 *
 * Who triggers it: only a seller's own status change ("STORE"). The other callers already e-mail the customer their
 * own way and are left exactly as they were: the admin order change (ORDER_STATUS from the admin route), the
 * customer's own cancel, the store's approval of a cancellation request (CANCELLATION_REQUEST_DECISION) and the
 * unpaid-order expiry.
 *
 * Exactly once per (store order, event): the outbox dedupe key `order-progress:<storeOrderId>:<event>` (hashed and
 * unique in EmailOutbox), so a status that goes back and forth never sends again.
 * Never blocks: the outbox row is written inside a SAVEPOINT; any failure (missing e-mail key, bad address, database
 * error) rolls back only the e-mail row, is logged without addresses, and the status change commits as usual.
 * Nothing is sent while EMAIL_WORKER_ENABLED is off: rows only wait in the outbox.
 * The e-mails never mention payment, prices or delivery times.
 */
import { absoluteSiteUrl } from "@/lib/category-seo";
import { enqueueEmail } from "@/lib/email-outbox";
import type { EmailPayload } from "@/lib/email-templates";

export type OrderProgressEvent = "CONFIRMED" | "ON_THE_WAY" | "DELIVERED" | "CANCELLED";
/** Who changed the status: decides whether this hook e-mails (see the comment above). */
export type StatusChangeSource = "STORE" | "ADMIN" | "CUSTOMER_CANCEL" | "STORE_APPROVED_CANCEL_REQUEST" | "UNPAID_EXPIRY";

export const ORDER_PROGRESS_TEMPLATE = "CUSTOMER_ORDER_PROGRESS";
/** Order statuses that have their own progress e-mail (the seller route skips its generic ORDER_STATUS for these). */
export const ORDER_PROGRESS_STATUSES = ["CONFIRMED", "HANDED_TO_COURIER", "SHIPPED", "DELIVERED", "CANCELLED"] as const;

/** The event for a seller's change to `targetStatus`, or null (no e-mail). Same status again: null. */
export function orderProgressEvent(fromStatus: string, targetStatus: string, source: StatusChangeSource): OrderProgressEvent | null {
  if (source !== "STORE" || fromStatus === targetStatus) return null;
  switch (targetStatus) {
    case "CONFIRMED": return "CONFIRMED";
    case "HANDED_TO_COURIER":
    case "SHIPPED": return "ON_THE_WAY";
    case "DELIVERED": return "DELIVERED";
    case "CANCELLED": return "CANCELLED";
    default: return null;
  }
}

/** The dedupe event key: one e-mail per store order and event, ever. */
export function orderProgressEventKey(storeOrderId: string, event: OrderProgressEvent): string {
  return `order-progress:${storeOrderId}:${event}`;
}

/** "#AB12CD34": the order number customers and sellers already see. */
export function customerOrderNumber(orderId: string): string {
  return `#${orderId.slice(-8).toUpperCase()}`;
}

const clean = (value: string, max: number) => value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** A plain single address, or null (then the e-mail is skipped). */
export function usableCustomerEmail(raw: string | null | undefined): string | null {
  const address = (raw ?? "").trim();
  if (!address || address.length > 254 || /[\s<>,;]/.test(address)) return null;
  return /^[^@]+@[^@]+\.[^@]+$/.test(address) ? address : null;
}

export function orderProgressPayload(input: { event: OrderProgressEvent; orderId: string; storeName: string }, base: string | undefined = process.env.APP_BASE_URL): EmailPayload {
  return {
    event: input.event,
    storeName: clean(input.storeName, 120) || "Mağaza",
    orderRef: customerOrderNumber(input.orderId),
    orderUrl: absoluteSiteUrl(`/orders/${input.orderId}`, base) ?? "",
  };
}

type HookClient = {
  storeOrder: { findUnique: (args: unknown) => Promise<unknown> };
  emailOutbox: unknown;
  $executeRawUnsafe: (query: string) => Promise<unknown>;
};
type HookRow = { id: string; orderId: string; store: { name: string } | null; order: { user: { email: string } | null } | null } | null;
export type OrderProgressResult = "QUEUED" | "NO_EVENT" | "NO_EMAIL" | "FAILED";

/**
 * Queues the customer's e-mail for one store-order status change. Call it inside the status-change transaction, after
 * the status was written. Never throws.
 */
export async function queueOrderProgressEmail(
  tx: HookClient,
  input: { storeOrderId: string; fromStatus: string; targetStatus: string; source: StatusChangeSource },
  deps: { enqueue?: typeof enqueueEmail; log?: (line: string) => void } = {},
): Promise<OrderProgressResult> {
  const event = orderProgressEvent(input.fromStatus, input.targetStatus, input.source);
  if (!event) return "NO_EVENT";
  const log = deps.log ?? ((line: string) => console.error(line));
  const enqueue = deps.enqueue ?? enqueueEmail;
  let savepoint = false;
  try {
    // Every query of this hook runs after the savepoint, so a failing query cannot abort the status transaction.
    await tx.$executeRawUnsafe("SAVEPOINT order_progress_email");
    savepoint = true;
    const row = await tx.storeOrder.findUnique({
      where: { id: input.storeOrderId },
      select: { id: true, orderId: true, store: { select: { name: true } }, order: { select: { user: { select: { email: true } } } } },
    }) as HookRow;
    const recipient = usableCustomerEmail(row?.order?.user?.email);
    if (!row || !recipient) {
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT order_progress_email");
      log(JSON.stringify({ event: "order_progress_email.skipped_no_email", storeOrderId: input.storeOrderId, progress: event }));
      return "NO_EMAIL";
    }
    const payload = orderProgressPayload({ event, orderId: row.orderId, storeName: row.store?.name ?? "" });
    await enqueue(tx as never, { eventKey: orderProgressEventKey(row.id, event), recipient, template: ORDER_PROGRESS_TEMPLATE, payload });
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT order_progress_email");
    return "QUEUED";
  } catch (error) {
    if (savepoint) await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT order_progress_email").catch(() => undefined);
    log(JSON.stringify({ event: "order_progress_email.queue_failed", storeOrderId: input.storeOrderId, progress: event, error: error instanceof Error ? error.name : "unknown" }));
    return "FAILED";
  }
}
