import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeMonthlyStoreSales, type StoreSalesOrder } from "@/lib/store-monthly-sales";

const date = (value: string) => new Date(`${value}T12:00:00.000Z`);
function order(overrides: Partial<StoreSalesOrder> & Pick<StoreSalesOrder, "id">): StoreSalesOrder {
  return {
    storeId: "store-1",
    status: "DELIVERED",
    subtotal: "100.00",
    commissionRateSnapshot: "0.1000",
    createdAt: date("2026-01-02"),
    deliveredAt: date("2026-01-03"),
    returnRequests: [],
    ...overrides,
  };
}

test("monthly report calculates commission from each order's stored snapshot", () => {
  const rows = summarizeMonthlyStoreSales([
    order({ id: "snapshot-10", subtotal: "100.00", commissionRateSnapshot: "0.1000" }),
    order({ id: "snapshot-12.5", subtotal: "100.00", commissionRateSnapshot: "0.1250" }),
  ]);

  assert.deepEqual(rows, [{
    storeId: "store-1",
    month: "2026-01",
    orders: 2,
    salesCents: 20_000,
    commissionCents: 2_250,
    rate: null,
    ordersWithoutRule: 0,
  }]);
});

test("a NULL commission snapshot is reported without inventing a rate", () => {
  const rows = summarizeMonthlyStoreSales([
    order({ id: "legacy", commissionRateSnapshot: null }),
  ]);

  assert.deepEqual(rows, [{
    storeId: "store-1",
    month: "2026-01",
    orders: 1,
    salesCents: 10_000,
    commissionCents: null,
    rate: null,
    ordersWithoutRule: 1,
  }]);
});

test("fully refunded orders do not contribute sales or commission", () => {
  const rows = summarizeMonthlyStoreSales([
    order({ id: "fully-refunded", returnRequests: [{ status: "REFUNDED", refundAmount: "100.00" }] }),
  ]);

  assert.deepEqual(rows, []);
});

test("partial refunds reduce the commission base; pending refunds are excluded", () => {
  const rows = summarizeMonthlyStoreSales([
    order({
      id: "partial",
      subtotal: "100.00",
      returnRequests: [
        { status: "REFUNDED", refundAmount: "25.00" },
        { status: "REFUND_PENDING", refundAmount: "10.00" },
      ],
    }),
  ]);

  assert.equal(rows[0]?.salesCents, 7_500);
  assert.equal(rows[0]?.commissionCents, 750);
});

test("refunds are capped at the merchandise subtotal", () => {
  const rows = summarizeMonthlyStoreSales([
    order({ id: "over-refunded", returnRequests: [{ status: "REFUNDED", refundAmount: "125.00" }] }),
    order({ id: "unrefunded" }),
  ]);

  assert.deepEqual(rows, [{
    storeId: "store-1",
    month: "2026-01",
    orders: 1,
    salesCents: 10_000,
    commissionCents: 1_000,
    rate: 0.1,
    ordersWithoutRule: 0,
  }]);
});

test("commission is rounded to cents per order before monthly aggregation", () => {
  const rows = summarizeMonthlyStoreSales([
    order({ id: "first", subtotal: "0.05", commissionRateSnapshot: "0.1000" }),
    order({ id: "second", subtotal: "0.05", commissionRateSnapshot: "0.1000" }),
  ]);

  assert.equal(rows[0]?.salesCents, 10);
  assert.equal(rows[0]?.commissionCents, 2);
});

test("orders are grouped independently by store and completion month", () => {
  const rows = summarizeMonthlyStoreSales([
    order({ id: "jan-store-1", commissionRateSnapshot: "0.1000" }),
    order({
      id: "feb-store-1",
      createdAt: date("2026-02-01"),
      deliveredAt: date("2026-02-01"),
      commissionRateSnapshot: "0.1000",
    }),
    order({ id: "jan-store-2", storeId: "store-2", commissionRateSnapshot: "0.1000" }),
  ]);

  assert.deepEqual(rows.map(({ storeId, month, orders }) => ({ storeId, month, orders })), [
    { storeId: "store-1", month: "2026-01", orders: 1 },
    { storeId: "store-2", month: "2026-01", orders: 1 },
    { storeId: "store-1", month: "2026-02", orders: 1 },
  ]);
});

test("the local calendar month is used across a UTC month boundary", () => {
  const justAfterLocalMidnight = new Date(2026, 9, 1, 0, 30);
  const rows = summarizeMonthlyStoreSales([
    order({ id: "local-month-boundary", deliveredAt: justAfterLocalMidnight }),
  ]);

  assert.equal(rows[0]?.month, "2026-10");
});

test("missing delivery time falls back to order creation time", () => {
  const rows = summarizeMonthlyStoreSales([
    order({ id: "legacy-date", createdAt: date("2026-02-01"), deliveredAt: null }),
  ]);

  assert.equal(rows[0]?.month, "2026-02");
});
