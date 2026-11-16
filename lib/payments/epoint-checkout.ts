import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readEpointConfig } from "@/lib/payments/epoint-config";
import { createEpointTransport, choosePaymentAttempt, requestEpointPayment, requestEpointStatus, verifyEpointCallback, type EpointTransport, type PaymentSnapshot, type VerifiedEpointResult } from "@/lib/payments/epoint-protocol";
import { commitEpointSettlement } from "@/lib/payments/epoint-settlement";

function paymentLog(event: string, fields: Record<string, string | undefined>) {
  const safe: Record<string, string> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (!value || /key|secret|signature|card|cvv|pan|token/i.test(key)) continue;
    safe[key] = value.slice(0, 80);
  }
  console.info(JSON.stringify(safe));
}

function snapshot(row: { id: string; orderId: string; amount: Prisma.Decimal; currency: string; status: PaymentSnapshot["status"]; providerReference: string | null }): PaymentSnapshot {
  return { id: row.id, orderId: row.orderId, amount: row.amount.toFixed(2), currency: row.currency, status: row.status, providerReference: row.providerReference };
}

export async function startEpointCheckout(userId: string, orderId: string, transport: EpointTransport = createEpointTransport()) {
  const config = readEpointConfig();
  if (!config) return { ok: false as const, code: "EPOINT_NOT_CONFIGURED" };
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
    const order = await tx.order.findFirst({ where: { id: orderId, userId }, include: { payments: true } });
    if (!order) return { code: "ORDER_NOT_FOUND" as const };
    const decision = choosePaymentAttempt({ userId: order.userId, total: order.total.toFixed(2), status: order.status, payments: order.payments.map(snapshot) }, userId);
    if (decision.code !== "READY") return decision;
    const reusable = order.payments.find((payment) => payment.status === "PENDING" && !payment.providerReference);
    const payment = reusable ?? await tx.payment.create({ data: { orderId: order.id, amount: order.total, currency: "AZN", status: "PENDING", provider: "epoint" } });
    const claim = await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING", providerReference: null }, data: { provider: "epoint", providerReference: `claim:${payment.id}` } });
    if (claim.count !== 1) return { code: "ALREADY_STARTED" as const };
    return { code: "READY" as const, paymentId: payment.id, amount: decision.amount, currency: decision.currency };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (claimed.code !== "READY") {
    paymentLog("epoint.initiate.rejected", { code: claimed.code, orderId });
    return { ok: false as const, code: claimed.code };
  }
  try {
    const created = await requestEpointPayment(config, { paymentId: claimed.paymentId, amount: claimed.amount, currency: claimed.currency, orderId }, transport);
    const saved = await prisma.payment.updateMany({ where: { id: claimed.paymentId, status: "PENDING", providerReference: `claim:${claimed.paymentId}` }, data: { providerReference: created.transaction } });
    if (saved.count !== 1) return { ok: false as const, code: "ALREADY_STARTED" };
    paymentLog("epoint.initiate.accepted", { orderId, traceId: created.traceId });
    return { ok: true as const, redirectUrl: created.redirectUrl, transaction: created.transaction };
  } catch {
    paymentLog("epoint.initiate.failed", { code: "EPOINT_REQUEST_FAILED", orderId });
    return { ok: false as const, code: "EPOINT_REQUEST_FAILED" };
  }
}

export async function settleVerifiedEpointResult(result: VerifiedEpointResult) {
  return prisma.$transaction(async (tx) => {
    const decision = await commitEpointSettlement({
      async find(id) {
        const row = await tx.payment.findUnique({ where: { id } });
        return row ? snapshot(row) : null;
      },
      async compareAndSet(id, from, to, transaction) {
        const updated = await tx.payment.updateMany({ where: { id, status: from }, data: { status: to, provider: "epoint", providerReference: transaction } });
        return updated.count === 1;
      },
    }, result);
    if (decision.type === "set" && decision.status === "PAID") await recordPaidAfterCancellation(tx, result.paymentId);
    return decision;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * A payment confirmed for an order that is (wholly or partly) cancelled: nothing is refunded automatically. An audit row
 * makes it visible; the admin refunds page lists every cancelled store order of a paid order as "refund needed".
 */
async function recordPaidAfterCancellation(tx: Prisma.TransactionClient, paymentId: string) {
  const payment = await tx.payment.findUnique({ where: { id: paymentId }, select: { orderId: true, order: { select: { status: true, storeOrders: { select: { id: true, status: true } } } } } });
  const cancelled = payment?.order.storeOrders.filter((storeOrder) => storeOrder.status === "CANCELLED") ?? [];
  if (!payment || !cancelled.length) return;
  await tx.auditLog.create({ data: {
    actorId: null, action: "PAYMENT_PAID_AFTER_CANCELLATION", entityType: "Order", entityId: payment.orderId,
    metadata: { paymentId, orderStatus: payment.order.status, cancelledStoreOrderIds: cancelled.map((storeOrder) => storeOrder.id), refund: "manual" },
  } });
  paymentLog("epoint.paid_after_cancellation", { orderId: payment.orderId });
}

export async function reconcileOwnedOrder(userId: string, orderId: string, transport: EpointTransport = createEpointTransport()) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, include: { payments: { orderBy: { createdAt: "desc" } } } });
  if (!order) return { ok: false as const, code: "ORDER_NOT_FOUND" };
  const payment = order.payments[0];
  if (!payment) return { ok: true as const, status: "PENDING" as const };
  const config = readEpointConfig();
  if (!config || payment.status !== "PENDING" || !payment.providerReference || payment.providerReference.startsWith("claim:")) return { ok: true as const, status: payment.status };
  const remote = await requestEpointStatus(config, payment.providerReference, transport);
  const decision = await settleVerifiedEpointResult({ ...remote, paymentId: payment.id, currency: remote.currency ?? payment.currency });
  if (decision.type === "reject") return { ok: false as const, code: decision.code };
  const current = await prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
  return { ok: true as const, status: current?.status ?? payment.status };
}

export async function acceptEpointCallback(data: string, signature: string, transport: EpointTransport = createEpointTransport()) {
  const config = readEpointConfig();
  if (!config) return { ok: false as const, status: 503, code: "EPOINT_NOT_CONFIGURED" };
  let callback: VerifiedEpointResult;
  try { callback = verifyEpointCallback(config, data, signature); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = message === "EPOINT_SIGNATURE_INVALID" ? message : "EPOINT_CALLBACK_INVALID";
    return { ok: false as const, status: code === "EPOINT_CALLBACK_INVALID" ? 422 : 400, code };
  }
  let remote: VerifiedEpointResult;
  try { remote = await requestEpointStatus(config, callback.transaction, transport); }
  catch { return { ok: false as const, status: 503, code: "EPOINT_STATUS_UNCONFIRMED" }; }
  if (remote.amount !== callback.amount || (remote.currency && callback.currency && remote.currency !== callback.currency)) return { ok: false as const, status: 422, code: "AMOUNT" };
  const decision = await settleVerifiedEpointResult({ ...remote, paymentId: callback.paymentId, currency: remote.currency ?? callback.currency ?? "AZN" });
  if (decision.type === "reject") {
    paymentLog("epoint.callback.rejected", { code: decision.code, traceId: remote.traceId });
    return { ok: false as const, status: decision.code === "NOT_FOUND" ? 404 : 422, code: decision.code };
  }
  paymentLog("epoint.callback.accepted", { code: decision.type === "set" ? decision.status : "UNCHANGED", traceId: remote.traceId });
  return { ok: true as const, status: 200, code: decision.type === "set" ? decision.status : "UNCHANGED" };
}
