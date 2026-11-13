import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeEpointData, epointSignature, epointSignaturesMatch } from "../lib/payments/epoint-signature";
import { readEpointConfig } from "../lib/payments/epoint-config";
import { buildEpointCreatePayload, choosePaymentAttempt, decideEpointSettlement, requestEpointPayment, requestEpointStatus, verifyEpointCallback, type PaymentSnapshot, type VerifiedEpointResult } from "../lib/payments/epoint-protocol";
import { commitEpointSettlement } from "../lib/payments/epoint-settlement";
import { getPaymentProvider } from "../lib/payments/provider";
import { consumePaymentRateLimit, paymentClientKey } from "../lib/payments/epoint-rate-limit";
import { readBoundedRequestBody } from "../lib/request-body";

const config = {
  environment: "sandbox" as const,
  publicKey: "i000000001",
  privateKey: "test-private-key",
  createPaymentUrl: "https://payments.example.test/create",
  statusUrl: "https://payments.example.test/status",
  appBaseUrl: "https://shopbagati.com",
};

function payment(overrides: Partial<PaymentSnapshot> = {}): PaymentSnapshot {
  return { id: "pay-1", orderId: "order-1", amount: "30.75", currency: "AZN", status: "PENDING", providerReference: null, ...overrides };
}

function result(overrides: Partial<VerifiedEpointResult> = {}): VerifiedEpointResult {
  return { paymentId: "pay-1", transaction: "te_1", providerStatus: "success", amount: "30.75", currency: "AZN", operationCode: "100", ...overrides };
}

test("Epoint signature uses raw SHA1 and rejects a changed payload", () => {
  const data = encodeEpointData(JSON.stringify({ amount: "30.75", order_id: "pay-1" }));
  const signature = epointSignature(config.privateKey, data);
  assert.equal(epointSignaturesMatch(config.privateKey, data, signature), true);
  assert.equal(epointSignaturesMatch(config.privateKey, data + "x", signature), false);
  assert.equal(epointSignaturesMatch("other-key", data, signature), false);
});

test("payment configuration stays disabled unless every production control is explicit", () => {
  assert.equal(readEpointConfig({ NODE_ENV: "test" }), null);
  assert.equal(readEpointConfig({ NODE_ENV: "test", EPOINT_PAYMENTS_ENABLED: "1", EPOINT_ENVIRONMENT: "production", EPOINT_PUBLIC_KEY: "i", EPOINT_PRIVATE_KEY: "secret", EPOINT_CREATE_PAYMENT_URL: "http://payments.example/create", EPOINT_STATUS_URL: "https://payments.example/status", APP_BASE_URL: "https://shopbagati.com" }), null);
  assert.equal(getPaymentProvider(), null);
});

test("create payload carries the server amount and not a client-supplied order total", () => {
  const signed = buildEpointCreatePayload(config, { paymentId: "pay-1", amount: "30.75", currency: "AZN", orderId: "order-1" });
  const payload = JSON.parse(Buffer.from(signed.data, "base64").toString("utf8"));
  assert.equal(payload.amount, "30.75");
  assert.equal(payload.currency, "AZN");
  assert.equal(payload.order_id, "pay-1");
  assert.equal(payload.public_key, "i000000001");
  assert.equal(payload.success_redirect_url, "https://shopbagati.com/orders/order-1?payment=return");
  assert.throws(() => buildEpointCreatePayload(config, { paymentId: "pay-1", amount: "1.00", currency: "GBP", orderId: "order-1" }), /EPOINT_REQUEST_INVALID/);
});

test("initiation refuses another customer's order, a bad amount, and a second charge", () => {
  const pending = payment();
  assert.equal(choosePaymentAttempt(null, "customer-1").code, "ORDER_NOT_FOUND");
  assert.equal(choosePaymentAttempt({ userId: "customer-2", total: "30.75", payments: [pending] }, "customer-1").code, "ORDER_NOT_FOUND");
  assert.equal(choosePaymentAttempt({ userId: "customer-1", total: "0.00", payments: [pending] }, "customer-1").code, "AMOUNT_INVALID");
  assert.equal(choosePaymentAttempt({ userId: "customer-1", total: "30.75", payments: [payment({ currency: "USD" })] }, "customer-1").code, "AMOUNT_INVALID");
  assert.equal(choosePaymentAttempt({ userId: "customer-1", total: "30.75", payments: [payment({ status: "PAID", providerReference: "te_1" })] }, "customer-1").code, "ALREADY_PAID");
  assert.equal(choosePaymentAttempt({ userId: "customer-1", total: "30.75", payments: [payment({ providerReference: "te_1" })] }, "customer-1").code, "ALREADY_STARTED");
});

test("callback signature, amount, currency, reference, and operation are enforced", () => {
  const fields = { order_id: "pay-1", status: "success", transaction: "te_1", amount: "30.75", currency: "AZN", operation_code: "100" };
  const data = encodeEpointData(JSON.stringify(fields));
  const signature = epointSignature(config.privateKey, data);
  assert.throws(() => verifyEpointCallback(config, data, "bad-signature"), /EPOINT_SIGNATURE_INVALID/);
  const verified = verifyEpointCallback(config, data, signature);
  assert.equal(verified.paymentId, "pay-1");
  assert.deepEqual(decideEpointSettlement(payment(), verified), { type: "set", status: "PAID" });
  assert.deepEqual(decideEpointSettlement(payment(), result({ amount: "30.76" })), { type: "reject", code: "AMOUNT" });
  assert.deepEqual(decideEpointSettlement(payment(), result({ currency: "USD" })), { type: "reject", code: "CURRENCY" });
  assert.deepEqual(decideEpointSettlement(payment({ providerReference: "te_other" }), result()), { type: "reject", code: "REFERENCE" });
  assert.deepEqual(decideEpointSettlement(payment(), result({ operationCode: "001" })), { type: "reject", code: "OPERATION" });
  assert.deepEqual(decideEpointSettlement(null, result()), { type: "reject", code: "NOT_FOUND" });
});

test("payment callback request bodies are bounded before form parsing", async () => {
  const body = new Request("https://bagati.invalid/api/payments/epoint/callback", {
    method: "POST",
    body: "data=abc&signature=123",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  assert.equal(await readBoundedRequestBody(body, 32 * 1024), "data=abc&signature=123");

  const oversized = new Request("https://bagati.invalid/api/payments/epoint/callback", {
    method: "POST",
    body: "x".repeat(32 * 1024 + 1),
  });
  await assert.rejects(readBoundedRequestBody(oversized, 32 * 1024), /BODY_TOO_LARGE/);

  const callbackRoute = readFileSync(new URL("../app/api/payments/epoint/callback/route.ts", import.meta.url), "utf8");
  assert.match(callbackRoute, /readBoundedRequestBody\(request, MAX_CALLBACK_BODY_BYTES\)/);
  assert.ok(callbackRoute.indexOf("readBoundedRequestBody(request, MAX_CALLBACK_BODY_BYTES)") < callbackRoute.indexOf("new URLSearchParams(body)"));
  assert.match(callbackRoute, /callback:global/);
  assert.match(callbackRoute, /paymentClientKey\(request\.headers\)/);
});

test("a paid order ignores a repeated success and rejects an older failure", () => {
  const paid = payment({ status: "PAID", providerReference: "te_1" });
  assert.deepEqual(decideEpointSettlement(paid, result()), { type: "unchanged", status: "PAID" });
  assert.deepEqual(decideEpointSettlement(paid, result({ providerStatus: "failed" })), { type: "reject", code: "DOWNGRADE" });
  assert.deepEqual(decideEpointSettlement(paid, result({ providerStatus: "error" })), { type: "reject", code: "DOWNGRADE" });
  assert.deepEqual(decideEpointSettlement(payment(), result({ providerStatus: "failed" })), { type: "set", status: "FAILED" });
  assert.deepEqual(decideEpointSettlement(payment(), result({ providerStatus: "new" })), { type: "unchanged", status: "PENDING" });
  assert.deepEqual(decideEpointSettlement(paid, result({ providerStatus: "returned" })), { type: "set", status: "REFUNDED" });
  assert.deepEqual(decideEpointSettlement(payment(), result({ providerStatus: "returned" })), { type: "reject", code: "STATUS" });
});

test("concurrent callbacks apply a payment only once", async () => {
  let current = payment();
  let writes = 0;
  const repository = {
    async find() { return { ...current }; },
    async compareAndSet(id: string, from: PaymentSnapshot["status"], to: "PAID" | "FAILED" | "REFUNDED", transaction: string) {
      if (current.id !== id || current.status !== from) return false;
      current = { ...current, status: to, providerReference: transaction };
      writes += 1;
      return true;
    },
  };
  const [first, second] = await Promise.all([commitEpointSettlement(repository, result()), commitEpointSettlement(repository, result())]);
  assert.equal(writes, 1);
  assert.equal(current.status, "PAID");
  assert.equal([first, second].filter((decision) => decision.type === "set").length, 1);
  assert.equal([first, second].some((decision) => decision.type === "unchanged"), true);
});

test("provider calls use the configured endpoints and a browser return cannot invent a paid status", async () => {
  const calls: string[] = [];
  const transport = async (url: string) => {
    calls.push(url);
    if (url.endsWith("/create")) return { status: "success", redirect_url: "https://bank.example/pay", transaction: "te_1", trace_id: "trace-1" };
    return { status: "success", transaction: "te_1", amount: 30.75, operation_code: "100", trace_id: "trace-2" };
  };
  const created = await requestEpointPayment(config, { paymentId: "pay-1", amount: "30.75", currency: "AZN", orderId: "order-1" }, transport);
  assert.equal(created.redirectUrl, "https://bank.example/pay");
  assert.deepEqual(calls, ["https://payments.example.test/create"]);
  const status = await requestEpointStatus(config, "te_1", transport);
  assert.equal(status.providerStatus, "success");
  assert.equal(status.amount, "30.75");
  await assert.rejects(requestEpointPayment(config, { paymentId: "pay-1", amount: "30.75", currency: "AZN", orderId: "order-1" }, async () => ({ status: "success", redirect_url: "http://evil.example/pay", transaction: "te_2" })), /EPOINT_RESPONSE_INVALID/);
  assert.equal(decideEpointSettlement(payment(), result({ providerStatus: "new" })).type, "unchanged");
});

test("payment attempts are rate limited without touching a database", () => {
  const key = `test:${Date.now()}`;
  assert.equal(consumePaymentRateLimit(key, 2, 60_000, 1_000), true);
  assert.equal(consumePaymentRateLimit(key, 2, 60_000, 1_001), true);
  assert.equal(consumePaymentRateLimit(key, 2, 60_000, 1_002), false);
  assert.equal(consumePaymentRateLimit(key, 2, 60_000, 61_000), true);
});

test("payment callback IP keys ignore untrusted forwarded headers", () => {
  const spoofed = new Headers({
    "cf-connecting-ip": "198.51.100.10",
    "x-forwarded-for": "192.0.2.30",
  });
  assert.equal(paymentClientKey(spoofed, false), null);
  assert.equal(paymentClientKey(spoofed, true), "trusted-ip:198.51.100.10");
  // CF-Connecting-IP and X-Real-IP disagreeing means the client IP is unknown (lib/trusted-proxy.ts): no per-client
  // key, so the callback falls back to the global limit only (as with an untrusted proxy); it is never blocked by it.
  assert.equal(paymentClientKey(new Headers({ "cf-connecting-ip": "198.51.100.10", "x-real-ip": "203.0.113.20" }), true), null);
  assert.equal(paymentClientKey(new Headers({ "cf-connecting-ip": "198.51.100.10", "x-real-ip": "198.51.100.10" }), true), "trusted-ip:198.51.100.10");
  assert.equal(paymentClientKey(new Headers({ "x-real-ip": "203.0.113.20" }), true), null);
  assert.equal(paymentClientKey(new Headers({ "cf-connecting-ip": "198.51.100.10, 203.0.113.20" }), true), null);
  assert.equal(paymentClientKey(new Headers({ "cf-connecting-ip": "not-an-ip" }), true), null);
});
