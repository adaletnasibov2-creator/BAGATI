import assert from "node:assert/strict";
import test from "node:test";
import {
  canCancelOrderDirectly,
  canRequestStoreOrderCancellation,
  isStoreOrderDispatched,
  orderCancellationView,
  refundNeeded,
  storeOrderCancellationState,
  type CancellationOrder,
} from "../lib/order-cancellation";

const ORDER_STATUSES = ["PENDING", "NEW", "CONFIRMED", "PREPARING", "PROCESSING", "READY", "HANDED_TO_COURIER", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"];
const SHIPMENT_STATUSES = [null, "PREPARING", "READY_FOR_SHIPMENT", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "RETURNED"];
const PAYMENTS = [[], ["PENDING"], ["FAILED"], ["FAILED", "PENDING"], ["PAID"], ["FAILED", "PAID"], ["REFUNDED"]];

const order = (storeOrders: CancellationOrder["storeOrders"], payments: string[] = ["PENDING"]): CancellationOrder =>
  ({ status: "PENDING", payments: payments.map((status) => ({ status })), storeOrders });

test("dispatched = order status HANDED_TO_COURIER/SHIPPED/DELIVERED/RETURNED or shipment status SHIPPED and later", () => {
  for (const status of ORDER_STATUSES) for (const shipmentStatus of SHIPMENT_STATUSES) {
    const expected = ["HANDED_TO_COURIER", "SHIPPED", "DELIVERED", "RETURNED"].includes(status)
      || ["SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "RETURNED"].includes(shipmentStatus ?? "");
    assert.equal(isStoreOrderDispatched({ status, shipmentStatus }), expected, `${status} / ${shipmentStatus}`);
  }
});

test("matrix: single store order, every status x shipment status x payment state", () => {
  for (const status of ORDER_STATUSES) for (const shipmentStatus of SHIPMENT_STATUSES) for (const payments of PAYMENTS) {
    const subject = order([{ id: "s1", status, shipmentStatus }], payments);
    const label = `${status} / ${shipmentStatus} / [${payments}]`;
    const paid = payments.includes("PAID");
    const closed = ["CANCELLED", "RETURNED"].includes(status);
    const delivered = status === "DELIVERED" || shipmentStatus === "DELIVERED";
    const dispatched = isStoreOrderDispatched({ status, shipmentStatus });
    // Rule 1: unpaid, not dispatched, not yet confirmed by the store.
    const direct = !paid && !closed && ["NEW", "PENDING"].includes(status) && !dispatched;
    assert.equal(canCancelOrderDirectly(subject), direct, `direct ${label}`);
    // Rules 2 and 3 per store order.
    const expectedState = closed ? "CLOSED" : delivered ? "DELIVERED" : dispatched ? "IN_TRANSIT" : "REQUEST";
    assert.equal(storeOrderCancellationState(subject.storeOrders[0]), expectedState, `state ${label}`);
    // A request is only offered when the direct cancel does not apply.
    assert.equal(canRequestStoreOrderCancellation(subject, "s1"), !direct && expectedState === "REQUEST", `request ${label}`);
  }
});

test("rule 1 needs every open store order unconfirmed; one confirmed store sends the customer to requests", () => {
  assert.equal(canCancelOrderDirectly(order([{ id: "a", status: "NEW", shipmentStatus: null }, { id: "b", status: "NEW", shipmentStatus: null }])), true);
  const mixed = order([{ id: "a", status: "NEW", shipmentStatus: null }, { id: "b", status: "CONFIRMED", shipmentStatus: null }]);
  assert.equal(canCancelOrderDirectly(mixed), false);
  assert.equal(canRequestStoreOrderCancellation(mixed, "a"), true);
  assert.equal(canRequestStoreOrderCancellation(mixed, "b"), true);
  // An already cancelled store order does not block the direct cancel of the rest.
  assert.equal(canCancelOrderDirectly(order([{ id: "a", status: "CANCELLED", shipmentStatus: null }, { id: "b", status: "NEW", shipmentStatus: null }])), true);
  // Nothing left open: nothing to cancel.
  assert.equal(canCancelOrderDirectly(order([{ id: "a", status: "CANCELLED", shipmentStatus: null }])), false);
});

test("one dispatched store order blocks the direct cancel; the other store order can still be requested", () => {
  const subject = order([{ id: "a", status: "NEW", shipmentStatus: "OUT_FOR_DELIVERY" }, { id: "b", status: "NEW", shipmentStatus: null }]);
  assert.equal(canCancelOrderDirectly(subject), false);
  assert.deepEqual(orderCancellationView(subject).storeOrders.map((row) => row.state), ["IN_TRANSIT", "REQUEST"]);
  assert.equal(canRequestStoreOrderCancellation(subject, "a"), false);
  assert.equal(canRequestStoreOrderCancellation(subject, "b"), true);
});

test("an open request: no second request, no direct cancel; a rejected request allows a new one", () => {
  const open = order([{ id: "a", status: "CONFIRMED", shipmentStatus: null, latestRequestStatus: "REQUESTED" }]);
  assert.equal(storeOrderCancellationState(open.storeOrders[0]), "REQUESTED");
  assert.equal(canRequestStoreOrderCancellation(open, "a"), false);
  assert.equal(canCancelOrderDirectly(order([{ id: "a", status: "NEW", shipmentStatus: null, latestRequestStatus: "REQUESTED" }], ["PAID"])), false);
  const rejected = order([{ id: "a", status: "CONFIRMED", shipmentStatus: null, latestRequestStatus: "REJECTED" }]);
  assert.equal(canRequestStoreOrderCancellation(rejected, "a"), true);
  assert.equal(orderCancellationView(rejected).storeOrders[0].lastRequestRejected, true);
  assert.equal(canRequestStoreOrderCancellation(open, "missing"), false);
});

test("refund needed only for a cancelled store order of an order with a PAID payment", () => {
  for (const status of ORDER_STATUSES) for (const payments of PAYMENTS) {
    assert.equal(refundNeeded({ payments: payments.map((s) => ({ status: s })) }, { status }), status === "CANCELLED" && payments.includes("PAID"), `${status} [${payments}]`);
  }
});
