import assert from "node:assert/strict";
import test from "node:test";
import { decodeCustomerOrderCursor, encodeCustomerOrderCursor, listCustomerOrderPage, parseCustomerOrderPageSize } from "../lib/customer-order-pagination";

type Row = ReturnType<typeof order>;
function order(id: string, day: string, userId = "customer-a") {
  return { id, userId, status: "DELIVERED", total: 12, createdAt: new Date(`${day}T00:00:00.000Z`), storeOrders: [], payments: [] };
}

function mockClient(rows: Row[]) {
  const calls: Record<string, unknown>[] = [];
  const client = { order: { findMany: async (args: Record<string, unknown>) => {
    calls.push(args);
    const where = args.where as { userId: string; AND?: Array<{ OR?: Array<Record<string, unknown>> }> };
    const orderBy = args.orderBy as Array<{ createdAt: "asc" | "desc" } | { id: "asc" | "desc" }>;
    let result = rows.filter((row) => row.userId === where.userId);
    const conditions = where.AND?.[0]?.OR;
    if (conditions) {
      const createdCondition = conditions.find((condition) => "createdAt" in condition && condition.createdAt instanceof Date) as { createdAt: Date } | undefined;
      const idCondition = conditions.find((condition) => "id" in condition) as { id: { gt?: string; lt?: string } } | undefined;
      const boundaryDate = createdCondition?.createdAt;
      const boundaryId = idCondition?.id.gt ?? idCondition?.id.lt;
      const operator = idCondition?.id.gt ? "gt" : "lt";
      if (boundaryDate && boundaryId) result = result.filter((row) => operator === "gt"
        ? row.createdAt > boundaryDate || (row.createdAt.getTime() === boundaryDate.getTime() && row.id > boundaryId)
        : row.createdAt < boundaryDate || (row.createdAt.getTime() === boundaryDate.getTime() && row.id < boundaryId));
    }
    result.sort((a, b) => {
      for (const item of orderBy) {
        const [field, direction] = Object.entries(item)[0] as ["createdAt" | "id", "asc" | "desc"];
        const compared = field === "createdAt" ? a.createdAt.getTime() - b.createdAt.getTime() : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        if (compared) return direction === "asc" ? compared : -compared;
      }
      return 0;
    });
    return result.slice(0, args.take as number);
  } } } as never;
  return { client, calls };
}

test("customer order history is user-scoped, bounded, and requests only list fields", async () => {
  const rows = Array.from({ length: 21 }, (_, index) => order(`order-${String(index).padStart(2, "0")}`, `2026-01-${String(21 - index).padStart(2, "0")}`));
  rows.push(order("other-customer-order", "2026-01-31", "customer-b"));
  const { client, calls } = mockClient(rows);
  const page = await listCustomerOrderPage(client, "customer-a");
  assert.equal(page.items.length, 20);
  assert.equal(page.hasNext, true);
  assert.equal(page.hasPrevious, false);
  assert.equal(calls[0].take, 21);
  assert.deepEqual(calls[0].where, { userId: "customer-a" });
  assert.deepEqual(calls[0].orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  const select = calls[0].select as Record<string, unknown>;
  assert.deepEqual(Object.keys(select).sort(), ["createdAt", "id", "payments", "status", "storeOrders", "total"].sort());
  assert.deepEqual(select.payments, {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { status: true },
  });
  assert.equal(decodeCustomerOrderCursor(page.nextCursor!)?.id, "order-19");
});

test("successive pages are disjoint and complete with identical timestamps and the ID tie-breaker", async () => {
  const rows = ["a", "b", "c", "d", "e", "f", "g"].map((id) => order(`order-${id}`, "2026-01-10"));
  const firstClient = mockClient(rows);
  const first = await listCustomerOrderPage(firstClient.client, "customer-a", { pageSize: 3 });
  const secondClient = mockClient(rows);
  const second = await listCustomerOrderPage(secondClient.client, "customer-a", { pageSize: 3, cursor: first.nextCursor! });
  const thirdClient = mockClient(rows);
  const third = await listCustomerOrderPage(thirdClient.client, "customer-a", { pageSize: 3, cursor: second.nextCursor! });
  const all = [...first.items, ...second.items, ...third.items].map(({ id }) => id);
  assert.deepEqual(all, ["order-g", "order-f", "order-e", "order-d", "order-c", "order-b", "order-a"]);
  assert.equal(new Set(all).size, rows.length);
  assert.equal(second.hasPrevious, true);
  assert.equal(third.hasNext, false);
});

test("a deleted cursor row does not prevent traversal because the tuple boundary is retained", async () => {
  const rows = ["a", "b", "c", "d", "e"].map((id, index) => order(`order-${id}`, `2026-01-0${index + 1}`));
  const first = await listCustomerOrderPage(mockClient(rows).client, "customer-a", { pageSize: 2 });
  const cursor = first.nextCursor!;
  const withoutCursorRow = rows.filter(({ id }) => id !== decodeCustomerOrderCursor(cursor)?.id);
  const next = await listCustomerOrderPage(mockClient(withoutCursorRow).client, "customer-a", { pageSize: 2, cursor });
  assert.deepEqual(next.items.map(({ id }) => id), ["order-c", "order-b"]);
  const back = await listCustomerOrderPage(mockClient(withoutCursorRow).client, "customer-a", { pageSize: 2, cursor: next.previousCursor! });
  assert.deepEqual(back.items.map(({ id }) => id), ["order-e"]);
});

test("empty before and after pages provide a usable reverse cursor without a navigation loop", async () => {
  const future = new Date("2030-01-01T00:00:00.000Z");
  const before = encodeCustomerOrderCursor({ id: "future", createdAt: future }, "before");
  const emptyBefore = await listCustomerOrderPage(mockClient([]).client, "customer-a", { cursor: before });
  assert.equal(emptyBefore.items.length, 0);
  assert.equal(emptyBefore.hasNext, true);
  assert.equal(emptyBefore.hasPrevious, false);
  const recovered = await listCustomerOrderPage(mockClient([order("order-a", "2026-01-01")]).client, "customer-a", { cursor: emptyBefore.nextCursor! });
  assert.deepEqual(recovered.items.map(({ id }) => id), ["order-a"]);
  const stillEmpty = await listCustomerOrderPage(mockClient([]).client, "customer-a", { cursor: emptyBefore.nextCursor! });
  assert.equal(stillEmpty.hasPrevious, false);
  assert.equal(stillEmpty.previousCursor, null);

  const old = encodeCustomerOrderCursor({ id: "old", createdAt: new Date("2020-01-01T00:00:00.000Z") }, "after");
  const emptyAfter = await listCustomerOrderPage(mockClient([]).client, "customer-a", { cursor: old });
  assert.equal(emptyAfter.hasPrevious, true);
  assert.ok(emptyAfter.previousCursor);
  assert.equal(decodeCustomerOrderCursor(emptyAfter.previousCursor!)?.direction, "before");
});

test("page-size and malformed cursor inputs fail closed", async () => {
  assert.equal(parseCustomerOrderPageSize(null), 20);
  assert.equal(parseCustomerOrderPageSize("50"), 50);
  assert.equal(parseCustomerOrderPageSize("51"), null);
  assert.equal(parseCustomerOrderPageSize("0"), null);
  await assert.rejects(listCustomerOrderPage(mockClient([]).client, "customer", { pageSize: 51 }), { message: "CUSTOMER_ORDER_PAGE_SIZE_INVALID" });
  await assert.rejects(listCustomerOrderPage(mockClient([]).client, "customer", { cursor: "invalid" }), { message: "CUSTOMER_ORDER_CURSOR_INVALID" });
});
