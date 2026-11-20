/**
 * New-order emails to sellers (SELLER-ALERTS, part A).
 *
 * POST /api/orders queues them AFTER the order transaction has committed, without awaiting: queuing can never fail,
 * roll back or slow down an order. One email per StoreOrder per recipient: the dedupe key
 * `seller-new-order:<storeOrderId>:<email>` (hashed by enqueueEmail) makes a second attempt a no-op.
 *
 * Recipients: the seller's account email, always; plus the store's extra notification email, only while it is
 * verified (and only when it differs from the account email).
 *
 * The email holds ONLY seller-side order facts: store name, order number, the store's items with quantities, the
 * store's subtotal / delivery / total and a link to the seller panel. Never the customer's name, phone, email or
 * address: the seller sees those in the panel after logging in.
 * The payload is encrypted in the outbox (lib/email-outbox.ts); nothing is sent while EMAIL_WORKER_ENABLED is off.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { absoluteSiteUrl } from "@/lib/category-seo";
import { enqueueEmail } from "@/lib/email-outbox";
import type { EmailPayload } from "@/lib/email-templates";

type Amount = Prisma.Decimal | number | string;

export type SellerOrderEmailStoreOrder = {
  id: string;
  storeId: string;
  subtotal: Amount;
  deliveryFee: Amount;
  store: { id: string; name: string; vendor: { user: { email: string } } };
  items: { productName: string; variantName: string | null; quantity: number }[];
};
export type SellerOrderEmailOrder = { id: string; storeOrders: SellerOrderEmailStoreOrder[] };
type StoreNotificationEmail = { id: string; notificationEmail: string | null; notificationEmailVerifiedAt: Date | null };

/** The order number sellers already see in the panel and in-app notifications: the last 8 characters, upper case. */
export function sellerOrderNumber(orderId: string): string {
  return orderId.slice(-8).toUpperCase();
}

const money = (value: Amount) => Number(value).toFixed(2);
const clean = (value: string, max: number) => value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** The account email always; the extra address only when verified and different. Lower-cased, unique. */
export function sellerOrderRecipients(accountEmail: string, store: Pick<StoreNotificationEmail, "notificationEmail" | "notificationEmailVerifiedAt"> | null): string[] {
  const account = accountEmail.trim().toLowerCase();
  const extra = store?.notificationEmail && store.notificationEmailVerifiedAt ? store.notificationEmail.trim().toLowerCase() : "";
  return extra && extra !== account ? [account, extra] : [account];
}

/** The encrypted payload of one SELLER_NEW_ORDER email. Seller-side facts only (no customer data). */
export function sellerOrderEmailPayload(order: { id: string }, storeOrder: SellerOrderEmailStoreOrder, base: string | undefined = process.env.APP_BASE_URL): EmailPayload {
  const subtotal = Number(storeOrder.subtotal), deliveryFee = Number(storeOrder.deliveryFee);
  const itemLines = storeOrder.items.map((item) => `${clean(item.productName, 120)}${item.variantName ? ` (${clean(item.variantName, 80)})` : ""} × ${item.quantity}`).join("\n");
  return {
    storeName: clean(storeOrder.store.name, 120),
    orderRef: sellerOrderNumber(order.id),
    storeOrderRef: storeOrder.id,
    itemLines,
    subtotal: money(subtotal),
    deliveryFee: money(deliveryFee),
    total: money(subtotal + deliveryFee),
    panelUrl: absoluteSiteUrl(`/vendor/${storeOrder.storeId}/orders/${storeOrder.id}`, base) ?? "",
  };
}

export function sellerOrderDedupeEventKey(storeOrderId: string, recipient: string): string {
  return `seller-new-order:${storeOrderId}:${recipient}`;
}

type QueueClient = Pick<PrismaClient, "emailOutbox" | "store">;

/**
 * Best effort: every recipient is queued on its own; a failure is logged (counts only, no addresses) and skipped.
 * Never throws. Returns how many rows were queued and how many failed.
 */
export async function queueSellerNewOrderEmails(client: QueueClient, order: SellerOrderEmailOrder): Promise<{ queued: number; failed: number }> {
  let queued = 0, failed = 0;
  try {
    const stores = await client.store.findMany({
      where: { id: { in: [...new Set(order.storeOrders.map((storeOrder) => storeOrder.storeId))] } },
      select: { id: true, notificationEmail: true, notificationEmailVerifiedAt: true },
    }).catch(() => [] as StoreNotificationEmail[]);
    const byId = new Map(stores.map((store) => [store.id, store]));
    for (const storeOrder of order.storeOrders) {
      const payload = sellerOrderEmailPayload(order, storeOrder);
      for (const recipient of sellerOrderRecipients(storeOrder.store.vendor.user.email, byId.get(storeOrder.storeId) ?? null)) {
        try {
          await enqueueEmail(client as never, { eventKey: sellerOrderDedupeEventKey(storeOrder.id, recipient), recipient, template: "SELLER_NEW_ORDER", payload });
          queued += 1;
        } catch {
          failed += 1;
        }
      }
    }
  } catch {
    failed += 1;
  }
  if (failed) console.error(JSON.stringify({ event: "seller_new_order_email.queue_failed", orderId: order.id, queued, failed }));
  return { queued, failed };
}
