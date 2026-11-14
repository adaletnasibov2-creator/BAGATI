import test from "node:test";
import assert from "node:assert/strict";
import { allowedShipmentTransitions, nextSimpleShipmentStatus, shipmentChangeAllowedForOrder, shipmentTimestamps, simpleShipmentStep } from "../lib/shipment-tracking";

test("shipment statuses allow only forward tracking transitions and documented retries", () => {
  // The simple flow (Hazırlanır -> Yolda -> Çatdırıldı) may skip the optional middle steps; still forward only.
  assert.deepEqual(allowedShipmentTransitions(null), ["PREPARING", "OUT_FOR_DELIVERY"]);
  assert.deepEqual(allowedShipmentTransitions("PREPARING"), ["READY_FOR_SHIPMENT", "OUT_FOR_DELIVERY"]);
  assert.deepEqual(allowedShipmentTransitions("READY_FOR_SHIPMENT"), ["SHIPPED", "OUT_FOR_DELIVERY"]);
  assert.deepEqual(allowedShipmentTransitions("SHIPPED"), ["OUT_FOR_DELIVERY", "DELIVERED", "DELIVERY_FAILED", "RETURNED"]);
  assert.deepEqual(allowedShipmentTransitions("OUT_FOR_DELIVERY"), ["DELIVERED", "DELIVERY_FAILED", "RETURNED"]);
  assert.deepEqual(allowedShipmentTransitions("DELIVERY_FAILED"), ["SHIPPED", "OUT_FOR_DELIVERY", "RETURNED"]);
  assert.deepEqual(allowedShipmentTransitions("DELIVERED"), []);
});

test("simple steps: Hazırlanır, Yolda, Çatdırıldı map onto the detailed statuses; never backwards", () => {
  assert.equal(simpleShipmentStep(null), -1);
  assert.deepEqual((["PREPARING", "READY_FOR_SHIPMENT", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERY_FAILED", "DELIVERED"] as const).map((status) => simpleShipmentStep(status)), [0, 0, 1, 1, 1, 2]);
  assert.equal(simpleShipmentStep("RETURNED", {}), 0);
  assert.equal(simpleShipmentStep("RETURNED", { outForDeliveryAt: new Date() }), 1);
  assert.equal(simpleShipmentStep("RETURNED", { deliveredAt: new Date() }), 2);
  assert.equal(nextSimpleShipmentStatus(null), "PREPARING");
  assert.equal(nextSimpleShipmentStatus("PREPARING"), "OUT_FOR_DELIVERY");
  assert.equal(nextSimpleShipmentStatus("READY_FOR_SHIPMENT"), "OUT_FOR_DELIVERY");
  assert.equal(nextSimpleShipmentStatus("SHIPPED"), "DELIVERED");
  assert.equal(nextSimpleShipmentStatus("OUT_FOR_DELIVERY"), "DELIVERED");
  assert.equal(nextSimpleShipmentStatus("DELIVERY_FAILED"), null, "after a failed attempt the retry is in the detailed form");
  assert.equal(nextSimpleShipmentStatus("DELIVERED"), null);
  assert.equal(nextSimpleShipmentStatus("RETURNED"), null);
});

test("shipment changes: refused on cancelled/returned orders; timestamps", () => {
  for (const status of ["NEW", "CONFIRMED", "PREPARING", "READY", "HANDED_TO_COURIER", "SHIPPED", "DELIVERED"]) assert.equal(shipmentChangeAllowedForOrder(status), true, status);
  assert.equal(shipmentChangeAllowedForOrder("CANCELLED"), false);
  assert.equal(shipmentChangeAllowedForOrder("RETURNED"), false);
  const now = new Date("2026-11-14T10:00:00Z"); const earlier = new Date("2026-11-13T10:00:00Z");
  assert.deepEqual(shipmentTimestamps("OUT_FOR_DELIVERY", { shippedAt: null }, now), { shippedAt: now, outForDeliveryAt: now });
  assert.deepEqual(shipmentTimestamps("OUT_FOR_DELIVERY", { shippedAt: earlier }, now), { outForDeliveryAt: now });
  assert.deepEqual(shipmentTimestamps("SHIPPED", { shippedAt: null }, now), { shippedAt: now });
  assert.deepEqual(shipmentTimestamps("DELIVERED", { shippedAt: earlier }, now), { deliveredAt: now });
  assert.deepEqual(shipmentTimestamps("PREPARING", { shippedAt: null }, now), {});
});
