import test from "node:test";
import assert from "node:assert/strict";
import { allowedShipmentTransitions } from "../lib/shipment-tracking";

test("shipment statuses allow only forward tracking transitions and documented retries", () => {
  assert.deepEqual(allowedShipmentTransitions(null), ["PREPARING"]);
  assert.deepEqual(allowedShipmentTransitions("PREPARING"), ["READY_FOR_SHIPMENT"]);
  assert.deepEqual(allowedShipmentTransitions("READY_FOR_SHIPMENT"), ["SHIPPED"]);
  assert.deepEqual(allowedShipmentTransitions("OUT_FOR_DELIVERY"), ["DELIVERED", "DELIVERY_FAILED", "RETURNED"]);
  assert.deepEqual(allowedShipmentTransitions("DELIVERY_FAILED"), ["SHIPPED", "OUT_FOR_DELIVERY", "RETURNED"]);
  assert.deepEqual(allowedShipmentTransitions("DELIVERED"), []);
});
