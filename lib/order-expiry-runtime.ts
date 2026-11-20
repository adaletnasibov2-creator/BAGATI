/**
 * Production wiring of the unpaid-order expiry loop (SCALE-FIX-4 B5). Imported only from instrumentation.ts.
 *
 * Starts only in the Node.js server runtime, never during `next build`, and only when Epoint is configured on the server
 * (EPOINT_PAYMENTS_ENABLED=1 and the full Epoint settings; lib/payments/epoint-config.ts). Without Epoint there is no
 * timer at all. With Epoint, every tick still does nothing until an admin switches on orders.unpaidExpiryEnabled.
 *
 * The Epoint check reuses the existing status request and settlement (the same calls as the customer's "reconcile"):
 * a successful payment becomes PAID and the order is kept; nothing in the payment logic changes.
 */
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings/read";
import { readEpointConfig } from "@/lib/payments/epoint-config";
import { createEpointTransport, requestEpointStatus, type EpointTransport } from "@/lib/payments/epoint-protocol";
import { settleVerifiedEpointResult } from "@/lib/payments/epoint-checkout";
import { runOrderExpiryTick, type ExpiryTickDependencies, type RemotePaymentCheck } from "@/lib/order-expiry";
import { createOrderExpiryLoop, type OrderExpiryLoop } from "@/lib/order-expiry-loop";

type Env = Record<string, string | undefined>;

/** Node.js server runtime, not the build, and Epoint configured. */
export function shouldStartOrderExpiryLoop(env: Env = process.env): boolean {
  return env.NEXT_RUNTIME === "nodejs" && env.NEXT_PHASE !== "phase-production-build" && readEpointConfig(env as NodeJS.ProcessEnv) !== null;
}

/** Ask Epoint about one payment attempt and apply the answer through the existing settlement path. Never throws. */
export async function checkRemotePayment(paymentId: string, transport: EpointTransport = createEpointTransport()): Promise<RemotePaymentCheck> {
  try {
    const config = readEpointConfig();
    if (!config) return "ERROR";
    const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { status: true, providerReference: true, currency: true } });
    if (!payment) return "ERROR";
    if (payment.status === "PAID") return "PAID";
    if (payment.status === "FAILED") return "FAILED";
    if (payment.status !== "PENDING" || !payment.providerReference || payment.providerReference.startsWith("claim:")) return "UNCHANGED";
    const remote = await requestEpointStatus(config, payment.providerReference, transport);
    const decision = await settleVerifiedEpointResult({ ...remote, paymentId, currency: remote.currency ?? payment.currency });
    if (decision.type === "reject") return "ERROR";
    const current = await prisma.payment.findUnique({ where: { id: paymentId }, select: { status: true } });
    if (current?.status === "PAID") return "PAID";
    if (current?.status === "FAILED") return "FAILED";
    return "UNCHANGED";
  } catch {
    return "ERROR";
  }
}

const runtimeState = globalThis as unknown as { __bagatiOrderExpiryLoop?: OrderExpiryLoop };

export function startOrderExpiryLoop(env: Env = process.env): OrderExpiryLoop | null {
  if (!shouldStartOrderExpiryLoop(env)) return null;
  if (runtimeState.__bagatiOrderExpiryLoop) return runtimeState.__bagatiOrderExpiryLoop;
  const loop = createOrderExpiryLoop({
    runTick: (excludeIds) => runOrderExpiryTick({
      db: prisma as unknown as ExpiryTickDependencies["db"],
      readSetting: (key) => getSetting(key),
      epointConfigured: () => readEpointConfig() !== null,
      checkRemotePayment: (paymentId) => checkRemotePayment(paymentId),
      excludeIds,
    }),
  });
  runtimeState.__bagatiOrderExpiryLoop = loop;
  loop.start();
  return loop;
}
