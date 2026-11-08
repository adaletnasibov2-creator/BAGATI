import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chargedReturnAmount, nextReturnStatus } from "../lib/returns";

test("return requests allow only the intended customer and vendor transitions", () => {
  assert.equal(nextReturnStatus("REQUESTED", "cancel", "REFUND"), "CANCELLED");
  assert.equal(nextReturnStatus("REQUESTED", "approve", "REFUND"), "APPROVED");
  assert.equal(nextReturnStatus("REQUESTED", "reject", "EXCHANGE"), "REJECTED");
  assert.equal(nextReturnStatus("APPROVED", "receive", "REFUND"), "ITEM_RECEIVED");
  assert.equal(nextReturnStatus("ITEM_RECEIVED", "restore-stock", "REFUND"), "ITEM_RECEIVED");
  assert.equal(nextReturnStatus("REQUESTED", "receive", "REFUND"), null);
  assert.equal(nextReturnStatus("REJECTED", "approve", "REFUND"), null);
});

test("return receipt routes to a pending refund or exchange without claiming completion", () => {
  assert.equal(nextReturnStatus("ITEM_RECEIVED", "process-resolution", "REFUND"), "REFUND_PENDING");
  assert.equal(nextReturnStatus("ITEM_RECEIVED", "process-resolution", "EXCHANGE"), "EXCHANGE_PENDING");
  assert.equal(nextReturnStatus("ITEM_RECEIVED", "cancel", "REFUND"), null);
  assert.equal(nextReturnStatus("REFUND_PENDING", "complete-exchange", "REFUND"), null);
  assert.equal(nextReturnStatus("EXCHANGE_PENDING", "complete-exchange", "EXCHANGE"), "EXCHANGED");
});

test("refund snapshot uses the historical charged line total, not a current product price", () => {
  const chargedAtOrder = chargedReturnAmount("37.45");
  const currentProductPrice = "99.00";
  assert.equal(chargedAtOrder, "37.45");
  assert.notEqual(chargedAtOrder, currentProductPrice);
});

test("seller overview surfaces this store's newly requested returns", () => {
  const dashboard = readFileSync(resolve(process.cwd(), "app/vendor/[storeId]/page.tsx"), "utf8");
  assert.match(dashboard, /returnRequest\.count\(\{ where: \{ storeId, status: "REQUESTED" \} \}\)/);
  assert.match(dashboard, /href: "returns"/);
});
