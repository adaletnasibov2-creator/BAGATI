/**
 * Guards around customer cancellation: payment start refuses cancelled orders, a late PAID on a cancelled order is
 * recorded, and no path may dispatch a store order (status or shipment) while a cancellation request is open.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { choosePaymentAttempt } from "../lib/payments/epoint-protocol";
import { isDispatchOrderStatus, isDispatchShipmentStatus } from "../lib/order-cancellation-guard";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("payment start refuses a cancelled order before anything else is checked", () => {
  const base = { userId: "u1", total: "10.00", payments: [] };
  assert.deepEqual(choosePaymentAttempt({ ...base, status: "CANCELLED" }, "u1"), { code: "ORDER_CANCELLED" });
  assert.equal(choosePaymentAttempt({ ...base, status: "PENDING" }, "u1").code, "READY");
  assert.equal(choosePaymentAttempt({ ...base, status: "CANCELLED" }, "someone-else").code, "ORDER_NOT_FOUND", "no information to other users");
  assert.match(read("lib/payments/epoint-checkout.ts"), /choosePaymentAttempt\(\{ userId: order\.userId, total: order\.total\.toFixed\(2\), status: order\.status,/);
  assert.match(read("app/api/payments/epoint/initiate/route.ts"), /Ləğv edilmiş sifariş üçün ödəniş başladıla bilməz/);
});

test("a PAID settlement on an order with a cancelled store order writes an audit row, refund stays manual", () => {
  const checkout = read("lib/payments/epoint-checkout.ts");
  assert.match(checkout, /if \(decision\.type === "set" && decision\.status === "PAID"\) await recordPaidAfterCancellation\(tx, result\.paymentId\);/);
  assert.match(checkout, /action: "PAYMENT_PAID_AFTER_CANCELLATION"/);
  assert.doesNotMatch(checkout, /status: "REFUNDED"/, "no refund is invented");
});

test("dispatch statuses: order status and shipment status", () => {
  for (const status of ["HANDED_TO_COURIER", "SHIPPED", "DELIVERED", "RETURNED"]) assert.equal(isDispatchOrderStatus(status), true, status);
  for (const status of ["NEW", "CONFIRMED", "PREPARING", "READY", "CANCELLED"]) assert.equal(isDispatchOrderStatus(status), false, status);
  for (const status of ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "RETURNED"]) assert.equal(isDispatchShipmentStatus(status), true, status);
  for (const status of ["PREPARING", "READY_FOR_SHIPMENT"]) assert.equal(isDispatchShipmentStatus(status), false, status);
});

test("every dispatch path checks for an open cancellation request; a store cancel approves it", () => {
  const fulfillment = read("lib/order-fulfillment.ts");
  assert.match(fulfillment, /if \(isDispatchOrderStatus\(input\.targetStatus\) && await hasOpenCancellationRequest\(tx, storeOrder\.id\)\) \{\s*throw new OrderFulfillmentError\("CANCELLATION_REQUEST_OPEN"\);/);
  assert.match(fulfillment, /if \(input\.targetStatus === "CANCELLED"\) await approveOpenRequestsOnStoreCancel\(tx, storeOrder\.id, input\.actorUserId\);/);
  assert.match(read("lib/shipment-admin.ts"), /if \(isDispatchShipmentStatus\(input\.target\) && await hasOpenCancellationRequest\(tx, current\.id\)\) throw new ShipmentAdminError\("CANCELLATION_REQUEST_OPEN"\);/);
  const seller = read("app/api/vendor/[storeId]/[section]/route.ts");
  assert.match(seller, /if\(s\.data\.shipmentStatus&&isDispatchShipmentStatus\(s\.data\.shipmentStatus\)&&await hasOpenCancellationRequest\(tx,locked\.id\)\)return \{error:"CANCELLATION_REQUEST_OPEN"\};/);
  assert.match(seller, /error\.code==="CANCELLATION_REQUEST_OPEN"\?CANCELLATION_REQUEST_OPEN_MESSAGE/);
  assert.match(read("app/api/admin/[...resource]/route.ts"), /error\.code === "CANCELLATION_REQUEST_OPEN" \? CANCELLATION_REQUEST_OPEN_MESSAGE/);
  assert.match(read("app/api/admin/store-orders/[storeOrderId]/shipment/route.ts"), /error\.code === "CANCELLATION_REQUEST_OPEN" \? CANCELLATION_REQUEST_OPEN_MESSAGE/);
});
