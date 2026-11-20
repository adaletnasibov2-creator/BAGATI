/**
 * Unpaid-order expiry (SCALE-FIX-4 B5, plan release-output/scale-fix-4-plan.md, owner decisions 2026-11-20).
 *
 * An order whose payment was not completed within N minutes is cancelled through the SAME path as every other cancel
 * (cancelStoreOrderLocked: Order row lock first, compare-and-set on the store order status, stock restored exactly once,
 * stock rows locked in inventory-id order). Stock comes back to the shop.
 *
 * Safety:
 *  - OFF by default (admin setting orders.unpaidExpiryEnabled). Until Epoint is live every real order is "Ödəniş
 *    gözləyir", which is normal; the switch stays off until then.
 *  - Even when ON, nothing happens unless Epoint is configured on the server (second lock, owner decision 2).
 *  - Only orders the customer could cancel directly (nothing paid; every open store order NEW/PENDING, not dispatched, no
 *    open cancellation request), older than N minutes, and with no payment attempt in flight.
 *  - A payment with an Epoint reference is checked with Epoint first (by the runtime, outside any transaction); only a
 *    definite "failed" lets the order expire. A "claim:" (payment start in progress) is never expired.
 *  - Each order is expired in its own short transaction: `FOR UPDATE SKIP LOCKED` on the Order row (an order someone is
 *    paying, cancelling or confirming right now is skipped), then every rule is checked again under the lock.
 *  - Idempotent: a second run sees CANCELLED and does nothing; email dedupe keys stop duplicate emails.
 */
import type { Prisma } from "@prisma/client";
import { cancelStoreOrderLocked } from "@/lib/order-fulfillment";
import { canCancelOrderDirectly, type CancellationStoreOrder } from "@/lib/order-cancellation";
import { enqueueEmail } from "@/lib/email-outbox";
import { ORDER_EXPIRED_UNPAID_REASON } from "@/lib/email-templates";
import { VENDOR_NOTIFICATION_TITLES } from "@/lib/vendor-notifications";
import { SETTING_KEYS } from "@/lib/settings/registry";

export const ORDER_EXPIRY_DEFAULT_MINUTES = 60;
export const ORDER_EXPIRY_MIN_MINUTES = 15;
export const ORDER_EXPIRY_MAX_MINUTES = 4320;
/** Most orders handled in one tick (owner decision 5). */
export const ORDER_EXPIRY_BATCH = 20;
export const ORDER_EXPIRED_AUDIT_ACTION = "ORDER_EXPIRED_UNPAID";

const SETTLED_PAYMENT_STATUSES = ["PAID", "AUTHORIZED", "REFUNDED"];
const CLAIM_PREFIX = "claim:";

export type ExpiryPayment = { id: string; status: string; providerReference: string | null };
export type ExpiryOrder = {
  status: string;
  createdAt: Date;
  payments: ExpiryPayment[];
  storeOrders: CancellationStoreOrder[];
};

export type ExpiryDecision =
  | "EXPIRE"
  | "CLOSED" // already cancelled / nothing open
  | "TOO_YOUNG" // created less than N minutes ago
  | "PAID" // a payment is PAID, AUTHORIZED or REFUNDED
  | "NOT_OPEN" // a store already confirmed, dispatched, or a cancellation request is open
  | "CLAIM_IN_PROGRESS" // a payment start holds a "claim:" reference
  | "PAYMENT_IN_FLIGHT"; // a PENDING payment has an Epoint reference: Epoint must say "failed" first

export const isClaimReference = (reference: string | null) => Boolean(reference?.startsWith(CLAIM_PREFIX));
/** A PENDING payment the customer opened on Epoint (a real transaction id, not a claim). */
export const hasProviderAttempt = (payment: ExpiryPayment) => payment.status === "PENDING" && Boolean(payment.providerReference) && !isClaimReference(payment.providerReference);

/** The whole rule, as a pure function. The service calls it again under the Order row lock. */
export function decideOrderExpiry(order: ExpiryOrder, now: Date, minutes: number): ExpiryDecision {
  if (order.status === "CANCELLED" || order.storeOrders.every((row) => row.status === "CANCELLED" || row.status === "RETURNED")) return "CLOSED";
  if (now.getTime() - order.createdAt.getTime() < minutes * 60_000) return "TOO_YOUNG";
  if (order.payments.some((payment) => SETTLED_PAYMENT_STATUSES.includes(payment.status))) return "PAID";
  if (!canCancelOrderDirectly({ status: order.status, payments: order.payments, storeOrders: order.storeOrders })) return "NOT_OPEN";
  if (order.payments.some((payment) => payment.status === "PENDING" && isClaimReference(payment.providerReference))) return "CLAIM_IN_PROGRESS";
  if (order.payments.some(hasProviderAttempt)) return "PAYMENT_IN_FLIGHT";
  return "EXPIRE";
}

type SettingReader = (key: string) => Promise<unknown>;
export type ExpirySettings = { enabled: boolean; minutes: number };

/** ON only when the stored value is exactly true; minutes fall back to the default when missing or out of range. */
export async function readExpirySettings(read: SettingReader): Promise<ExpirySettings> {
  let enabled = false;
  let minutes = ORDER_EXPIRY_DEFAULT_MINUTES;
  try { enabled = (await read(SETTING_KEYS.ordersUnpaidExpiryEnabled)) === true; } catch { enabled = false; }
  try {
    const raw = await read(SETTING_KEYS.ordersUnpaidExpiryMinutes);
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= ORDER_EXPIRY_MIN_MINUTES && raw <= ORDER_EXPIRY_MAX_MINUTES) minutes = raw;
  } catch { minutes = ORDER_EXPIRY_DEFAULT_MINUTES; }
  return { enabled, minutes };
}

/** A Prisma code (P2034, …), an OrderFulfillmentError code, or "UNKNOWN". Never a message, id or query. */
export function safeExpiryErrorCode(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return /^(P\d{4}|[A-Z_]{3,40})$/.test(code) ? code : "UNKNOWN";
}

const shortRef = (id: string) => id.slice(-8).toUpperCase();
export const SELLER_EXPIRED_BODY = (orderId: string) => `Sifariş #${shortRef(orderId)} ödəniş vaxtında tamamlanmadığı üçün avtomatik ləğv edildi. Stok bərpa edildi; sifarişi göndərməyin.`;

type Tx = Prisma.TransactionClient;
type Db = { $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> };

export type ExpireOneResult = { outcome: "EXPIRED"; storeOrderIds: string[] } | { outcome: "LOCKED" | "NOT_FOUND" | Exclude<ExpiryDecision, "EXPIRE"> };

/**
 * Expire one order in its own transaction. `epointChecked` = the runtime asked Epoint about a payment attempt first
 * (recorded in the audit row only).
 */
export async function expireUnpaidOrder(db: Db, input: { orderId: string; now: Date; minutes: number; epointChecked?: boolean }): Promise<ExpireOneResult> {
  return db.$transaction(async (tx) => {
    // Someone else holds the order (payment start, customer, seller, admin): skip it this tick instead of waiting.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE SKIP LOCKED`;
    if (!locked.length) {
      const exists = await tx.order.findUnique({ where: { id: input.orderId }, select: { id: true } });
      return { outcome: exists ? "LOCKED" : "NOT_FOUND" };
    }
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true, userId: true, status: true, createdAt: true,
        user: { select: { email: true } },
        payments: { select: { id: true, status: true, providerReference: true } },
        storeOrders: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true, storeId: true, status: true, shipmentStatus: true,
            store: { select: { name: true, vendor: { select: { user: { select: { id: true, email: true } } } } } },
            cancellationRequests: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
          },
        },
      },
    });
    if (!order) return { outcome: "NOT_FOUND" };
    const decision = decideOrderExpiry({
      status: order.status,
      createdAt: order.createdAt,
      payments: order.payments,
      storeOrders: order.storeOrders.map((row) => ({ id: row.id, status: row.status, shipmentStatus: row.shipmentStatus, latestRequestStatus: row.cancellationRequests[0]?.status ?? null })),
    }, input.now, input.minutes);
    if (decision !== "EXPIRE") return { outcome: decision };

    const cancelled: string[] = [];
    for (const storeOrder of order.storeOrders) {
      if (storeOrder.status === "CANCELLED" || storeOrder.status === "RETURNED") continue;
      // Actor of the stock-restore rows = the order's customer (owner decision 3; InventoryAdjustment needs a user).
      await cancelStoreOrderLocked(tx, { id: storeOrder.id, storeId: storeOrder.storeId, actorUserId: order.userId });
      cancelled.push(storeOrder.id);
    }
    // Payments the customer never opened on Epoint end here. (An attempt Epoint reported as failed is FAILED already.)
    const failed = await tx.payment.updateMany({ where: { orderId: order.id, status: "PENDING", providerReference: null }, data: { status: "FAILED" } });

    await tx.auditLog.create({ data: {
      actorId: null, action: ORDER_EXPIRED_AUDIT_ACTION, entityType: "Order", entityId: order.id,
      metadata: { storeOrderIds: cancelled, expiryMinutes: input.minutes, orderCreatedAt: order.createdAt.toISOString(), pendingPaymentsFailed: failed.count, epointChecked: Boolean(input.epointChecked) },
    } });
    await enqueueEmail(tx, { eventKey: `order-expired:${order.id}:customer`, recipient: order.user.email, template: "ORDER_STATUS", payload: { orderRef: order.id, storeName: "BAGATI", status: "CANCELLED", reason: ORDER_EXPIRED_UNPAID_REASON } });
    for (const storeOrder of order.storeOrders.filter((row) => cancelled.includes(row.id))) {
      const seller = storeOrder.store.vendor?.user;
      if (!seller) continue;
      await enqueueEmail(tx, { eventKey: `order-expired:${storeOrder.id}:seller`, recipient: seller.email, template: "SELLER_ORDER_CANCELLED", payload: { storeName: storeOrder.store.name, orderRef: order.id, storeOrderRef: storeOrder.id } });
      await tx.notification.create({ data: { userId: seller.id, storeId: storeOrder.storeId, title: VENDOR_NOTIFICATION_TITLES.orderExpiredUnpaid, body: SELLER_EXPIRED_BODY(order.id) } });
    }
    return { outcome: "EXPIRED", storeOrderIds: cancelled };
  });
}

export type RemotePaymentCheck = "PAID" | "FAILED" | "UNCHANGED" | "ERROR";
export type CandidateOrder = { id: string; payments: ExpiryPayment[] };

export type ExpiryTickDependencies = {
  db: Db & { order: { findMany(args: unknown): Promise<CandidateOrder[]> } };
  readSetting: SettingReader;
  epointConfigured: () => boolean;
  /** Ask Epoint about one payment attempt and apply the answer through the existing settlement path. */
  checkRemotePayment: (paymentId: string) => Promise<RemotePaymentCheck>;
  now?: () => Date;
  batch?: number;
  /** Ids to leave out of this tick (attempts Epoint still reports as open; see the runtime's back-off). */
  excludeIds?: readonly string[];
};

export type ExpiryTickResult =
  | { state: "off" | "epoint_not_configured" }
  | { state: "ran"; minutes: number; candidates: number; expired: number; skippedLocked: number; skippedPaid: number; skippedInFlight: number; skippedClaim: number; skippedOther: number; errors: number; errorCodes: string[]; inFlightIds: string[] };

/** One tick. Never throws for a single order; an error is counted and the next order continues. */
export async function runOrderExpiryTick(deps: ExpiryTickDependencies): Promise<ExpiryTickResult> {
  const settings = await readExpirySettings(deps.readSetting);
  if (!settings.enabled) return { state: "off" };
  if (!deps.epointConfigured()) return { state: "epoint_not_configured" };
  const now = (deps.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - settings.minutes * 60_000);
  const candidates = await deps.db.order.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: cutoff },
      ...(deps.excludeIds?.length ? { id: { notIn: [...deps.excludeIds] } } : {}),
      // Leave out orders that can never expire, so they do not fill every batch.
      payments: { none: { OR: [{ status: { in: SETTLED_PAYMENT_STATUSES } }, { status: "PENDING", providerReference: { startsWith: CLAIM_PREFIX } }] } },
    },
    orderBy: { createdAt: "asc" },
    take: deps.batch ?? ORDER_EXPIRY_BATCH,
    select: { id: true, payments: { select: { id: true, status: true, providerReference: true } } },
  });
  const result = { state: "ran" as const, minutes: settings.minutes, candidates: candidates.length, expired: 0, skippedLocked: 0, skippedPaid: 0, skippedInFlight: 0, skippedClaim: 0, skippedOther: 0, errors: 0, errorCodes: [] as string[], inFlightIds: [] as string[] };
  for (const candidate of candidates) {
    try {
      const attempts = candidate.payments.filter(hasProviderAttempt);
      let paid = false;
      let open = false;
      for (const attempt of attempts) {
        const remote = await deps.checkRemotePayment(attempt.id);
        if (remote === "PAID") paid = true;
        else if (remote !== "FAILED") open = true; // UNCHANGED or ERROR: never expire on uncertainty
      }
      if (paid) { result.skippedPaid++; continue; }
      if (open) { result.skippedInFlight++; result.inFlightIds.push(candidate.id); continue; }
      const outcome = await expireUnpaidOrder(deps.db, { orderId: candidate.id, now, minutes: settings.minutes, epointChecked: attempts.length > 0 });
      if (outcome.outcome === "EXPIRED") result.expired++;
      else if (outcome.outcome === "LOCKED") result.skippedLocked++;
      else if (outcome.outcome === "PAID") result.skippedPaid++;
      else if (outcome.outcome === "PAYMENT_IN_FLIGHT") { result.skippedInFlight++; result.inFlightIds.push(candidate.id); }
      else if (outcome.outcome === "CLAIM_IN_PROGRESS") result.skippedClaim++;
      else result.skippedOther++;
    } catch (error) {
      result.errors++;
      const code = safeExpiryErrorCode(error);
      if (!result.errorCodes.includes(code)) result.errorCodes.push(code);
    }
  }
  return result;
}
