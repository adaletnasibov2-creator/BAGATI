import { Prisma } from "@prisma/client";
import { decodeEpointData, encodeEpointData, epointSignature, epointSignaturesMatch } from "@/lib/payments/epoint-signature";
import type { EpointConfig } from "@/lib/payments/epoint-config";

const CURRENCIES = new Set(["AZN", "USD", "EUR", "RUB"]);
const PROVIDER_STATUSES = new Set(["success", "failed", "new", "returned", "error", "server_error"]);

export type EpointProviderStatus = "success" | "failed" | "new" | "returned" | "error" | "server_error";

export type VerifiedEpointResult = {
  paymentId: string;
  transaction: string;
  providerStatus: EpointProviderStatus;
  amount: string;
  currency?: string;
  operationCode?: string;
  traceId?: string;
};

export type PaymentSnapshot = {
  id: string;
  orderId: string;
  amount: string;
  currency: string;
  status: "PENDING" | "AUTHORIZED" | "PAID" | "FAILED" | "REFUNDED";
  providerReference: string | null;
};

export type SettlementDecision =
  | { type: "unchanged"; status: PaymentSnapshot["status"] }
  | { type: "reject"; code: "NOT_FOUND" | "REFERENCE" | "AMOUNT" | "CURRENCY" | "OPERATION" | "DOWNGRADE" | "STATUS" }
  | { type: "set"; status: "PAID" | "FAILED" | "REFUNDED" };

export function formatEpointAmount(amount: Prisma.Decimal.Value) {
  const decimal = new Prisma.Decimal(amount);
  if (!decimal.isFinite() || decimal.lte(0) || decimal.decimalPlaces() > 2) return null;
  return decimal.toFixed(2);
}

export function parseEpointAmount(value: unknown) {
  if (typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value)) return new Prisma.Decimal(value).toFixed(2);
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const text = value.toFixed(2);
    if (Math.abs(value - Number(text)) < 1e-9) return text;
  }
  return null;
}

export function buildEpointCreatePayload(config: EpointConfig, input: { paymentId: string; amount: string; currency: string; orderId: string }) {
  if (!CURRENCIES.has(input.currency) || input.paymentId.length > 255) throw new Error("EPOINT_REQUEST_INVALID");
  const payload = JSON.stringify({
    public_key: config.publicKey,
    amount: input.amount,
    currency: input.currency,
    language: "az",
    order_id: input.paymentId,
    description: `BAGATI ${input.orderId}`.slice(0, 1000),
    is_installment: 0,
    success_redirect_url: `${config.appBaseUrl}/orders/${input.orderId}?payment=return`,
    error_redirect_url: `${config.appBaseUrl}/orders/${input.orderId}?payment=return`,
  });
  const data = encodeEpointData(payload);
  return { data, signature: epointSignature(config.privateKey, data) };
}

export function verifyEpointCallback(config: EpointConfig, data: string, signature: string): VerifiedEpointResult {
  if (!data || data.length > 8192 || !signature || !epointSignaturesMatch(config.privateKey, data, signature)) throw new Error("EPOINT_SIGNATURE_INVALID");
  let decoded: unknown;
  try { decoded = decodeEpointData(data); } catch { throw new Error("EPOINT_SIGNATURE_INVALID"); }
  if (!decoded || typeof decoded !== "object") throw new Error("EPOINT_CALLBACK_INVALID");
  const body = decoded as Record<string, unknown>;
  const providerStatus = body.status;
  const paymentId = body.order_id;
  const transaction = body.transaction;
  const amount = parseEpointAmount(body.amount);
  if (typeof providerStatus !== "string" || !PROVIDER_STATUSES.has(providerStatus)) throw new Error("EPOINT_CALLBACK_INVALID");
  if (typeof paymentId !== "string" || !paymentId || typeof transaction !== "string" || !transaction || !amount) throw new Error("EPOINT_CALLBACK_INVALID");
  const currency = typeof body.currency === "string" ? body.currency : undefined;
  const operationCode = typeof body.operation_code === "string" ? body.operation_code : undefined;
  const traceId = typeof body.trace_id === "string" ? body.trace_id : undefined;
  return { paymentId, transaction, providerStatus: providerStatus as EpointProviderStatus, amount, currency, operationCode, traceId };
}

export function choosePaymentAttempt(order: { userId: string; total: string; payments: PaymentSnapshot[] } | null, userId: string) {
  if (!order || order.userId !== userId) return { code: "ORDER_NOT_FOUND" as const };
  const amount = formatEpointAmount(order.total);
  if (!amount || order.payments.some((payment) => payment.currency !== "AZN")) return { code: "AMOUNT_INVALID" as const };
  if (order.payments.some((payment) => payment.status === "PAID")) return { code: "ALREADY_PAID" as const };
  if (order.payments.some((payment) => payment.status === "PENDING" && payment.providerReference)) return { code: "ALREADY_STARTED" as const };
  return { code: "READY" as const, amount, currency: "AZN" as const };
}

export function decideEpointSettlement(payment: PaymentSnapshot | null, result: VerifiedEpointResult): SettlementDecision {
  if (!payment || payment.id !== result.paymentId) return { type: "reject", code: "NOT_FOUND" };
  if (result.currency && result.currency !== payment.currency) return { type: "reject", code: "CURRENCY" };
  if (result.amount !== formatEpointAmount(payment.amount)) return { type: "reject", code: "AMOUNT" };
  if (result.operationCode && result.operationCode !== "100") return { type: "reject", code: "OPERATION" };
  const storedReference = payment.providerReference?.startsWith("claim:") ? null : payment.providerReference;
  if (storedReference && storedReference !== result.transaction) return { type: "reject", code: "REFERENCE" };
  if (result.providerStatus === "new" || result.providerStatus === "server_error") return { type: "unchanged", status: payment.status };
  if (result.providerStatus === "success") {
    if (payment.status === "PAID") return { type: "unchanged", status: "PAID" };
    if (payment.status === "REFUNDED") return { type: "reject", code: "DOWNGRADE" };
    return { type: "set", status: "PAID" };
  }
  if (result.providerStatus === "returned") {
    if (payment.status === "REFUNDED") return { type: "unchanged", status: "REFUNDED" };
    if (payment.status !== "PAID") return { type: "reject", code: "STATUS" };
    return { type: "set", status: "REFUNDED" };
  }
  if (result.providerStatus === "failed" || result.providerStatus === "error") {
    if (payment.status === "PAID" || payment.status === "REFUNDED") return { type: "reject", code: "DOWNGRADE" };
    if (payment.status === "FAILED") return { type: "unchanged", status: "FAILED" };
    return { type: "set", status: "FAILED" };
  }
  return { type: "reject", code: "STATUS" };
}

export type EpointTransport = (url: string, body: URLSearchParams) => Promise<unknown>;

export function createEpointTransport(fetchImpl: typeof fetch = fetch): EpointTransport {
  return async (url, body) => {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("EPOINT_REQUEST_FAILED");
    try { return await response.json(); } catch { throw new Error("EPOINT_RESPONSE_INVALID"); }
  };
}

export async function requestEpointPayment(config: EpointConfig, input: { paymentId: string; amount: string; currency: string; orderId: string }, transport: EpointTransport) {
  const signed = buildEpointCreatePayload(config, input);
  const body = await transport(config.createPaymentUrl, new URLSearchParams(signed));
  if (!body || typeof body !== "object") throw new Error("EPOINT_RESPONSE_INVALID");
  const response = body as Record<string, unknown>;
  if (response.status !== "success" || typeof response.redirect_url !== "string" || typeof response.transaction !== "string") throw new Error("EPOINT_RESPONSE_INVALID");
  const redirect = new URL(response.redirect_url);
  const local = redirect.hostname === "localhost" || redirect.hostname === "127.0.0.1";
  if (redirect.protocol !== "https:" && !(config.environment === "sandbox" && redirect.protocol === "http:" && local)) throw new Error("EPOINT_RESPONSE_INVALID");
  return { redirectUrl: redirect.toString(), transaction: response.transaction, traceId: typeof response.trace_id === "string" ? response.trace_id : undefined };
}

export async function requestEpointStatus(config: EpointConfig, transaction: string, transport: EpointTransport): Promise<VerifiedEpointResult> {
  const payload = JSON.stringify({ public_key: config.publicKey, transaction });
  const data = encodeEpointData(payload);
  const body = await transport(config.statusUrl, new URLSearchParams({ data, signature: epointSignature(config.privateKey, data) }));
  if (!body || typeof body !== "object") throw new Error("EPOINT_RESPONSE_INVALID");
  const response = body as Record<string, unknown>;
  const providerStatus = response.status;
  const amount = parseEpointAmount(response.amount);
  if (typeof providerStatus !== "string" || !PROVIDER_STATUSES.has(providerStatus) || response.transaction !== transaction || !amount) throw new Error("EPOINT_RESPONSE_INVALID");
  return {
    paymentId: "",
    transaction,
    providerStatus: providerStatus as EpointProviderStatus,
    amount,
    currency: typeof response.currency === "string" ? response.currency : undefined,
    operationCode: typeof response.operation_code === "string" ? response.operation_code : undefined,
    traceId: typeof response.trace_id === "string" ? response.trace_id : undefined,
  };
}
