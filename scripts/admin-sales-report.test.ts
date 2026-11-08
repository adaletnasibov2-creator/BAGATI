import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDeliveredSales, type DeliveredSalesOrder } from "../lib/admin-sales-report";
import { formatLocalDateInput, parseLocalDateRange } from "../lib/admin-report-dates";

const deliveredAt = new Date("2026-10-09T12:00:00.000Z");
const order: DeliveredSalesOrder = {
  id: "order-1",
  storeId: "store-1",
  status: "DELIVERED",
  createdAt: new Date("2026-10-08T12:00:00.000Z"),
  deliveredAt,
  subtotal: "30.00",
  items: [
    { id: "item-1", productName: "Product A", quantity: 2, lineTotal: "20.00" },
    { id: "item-2", productName: "Product B", quantity: 1, lineTotal: "10.00" },
  ],
  returnRequests: [
    { orderItemId: "item-1", status: "REFUNDED", refundAmount: "5.00" },
    { orderItemId: "item-2", status: "APPROVED", refundAmount: "10.00" },
  ],
};

test("delivered sales totals deduct only confirmed refunds at order and product level", () => {
  const summary = summarizeDeliveredSales([order]);

  assert.equal(summary.orders, 1);
  assert.equal(summary.revenueCents, 2500);
  assert.equal(summary.quantity, 3);
  assert.deepEqual(summary.daily.map(({ id, count, revenueCents, quantity }) => ({ id, count, revenueCents, quantity })), [
    { id: "2026-10-09", count: 1, revenueCents: 2500, quantity: 3 },
  ]);
  assert.deepEqual(summary.byStore.map(({ id, count, revenueCents, quantity }) => ({ id, count, revenueCents, quantity })), [
    { id: "store-1", count: 1, revenueCents: 2500, quantity: 3 },
  ]);
  assert.deepEqual(summary.byProduct.map(({ id, count, revenueCents, quantity }) => ({ id, count, revenueCents, quantity })), [
    { id: "Product A", count: 1, revenueCents: 1500, quantity: 2 },
    { id: "Product B", count: 1, revenueCents: 1000, quantity: 1 },
  ]);
});

test("fully refunded and non-delivered orders are excluded from net sales", () => {
  const fullyRefunded = {
    ...order,
    id: "order-2",
    returnRequests: [
      { orderItemId: "item-1", status: "REFUNDED", refundAmount: "20.00" },
      { orderItemId: "item-2", status: "REFUNDED", refundAmount: "10.00" },
    ],
  };
  const pending = { ...order, id: "order-3", status: "CANCELLED" };
  const summary = summarizeDeliveredSales([fullyRefunded, pending]);

  assert.equal(summary.orders, 0);
  assert.equal(summary.revenueCents, 0);
  assert.equal(summary.quantity, 3, "delivered quantity remains a fulfillment metric even when fully refunded");
  assert.deepEqual(summary.daily.map(({ count, revenueCents, quantity }) => ({ count, revenueCents, quantity })), [
    { count: 0, revenueCents: 0, quantity: 3 },
  ]);
  assert.deepEqual(summary.byProduct.map(({ count, revenueCents, quantity }) => ({ count, revenueCents, quantity })), [
    { count: 1, revenueCents: 0, quantity: 2 },
    { count: 1, revenueCents: 0, quantity: 1 },
  ]);
});

test("date input ranges and displayed sales dates use the same local calendar day", () => {
  const range = parseLocalDateRange("2026-10-11");
  assert.ok(range);
  assert.equal(formatLocalDateInput(range.start), "2026-10-11");
  assert.equal(formatLocalDateInput(range.end), "2026-10-11");

  const deliveredAt = new Date(2026, 9, 11, 23, 59, 59, 999);
  assert.ok(deliveredAt >= range.start && deliveredAt <= range.end);
  assert.equal(formatLocalDateInput(new Date(2026, 9, 12, 0, 0, 0)), "2026-10-12");
  assert.equal(parseLocalDateRange("2026-02-30"), null);
  assert.equal(parseLocalDateRange("2026-10-1"), null);

  const justAfterMidnight = new Date(2026, 9, 11, 0, 30);
  const summary = summarizeDeliveredSales([{ ...order, deliveredAt: justAfterMidnight }]);
  assert.equal(summary.daily[0]?.id, "2026-10-11");
});
