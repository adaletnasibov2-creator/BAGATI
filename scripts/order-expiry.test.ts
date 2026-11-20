/**
 * SCALE-FIX-4 B5 (unpaid-order expiry) and A9 (pool log line). No database: an in-memory transaction runs the REAL cancel
 * and stock-restore code (lib/order-fulfillment.ts) through lib/order-expiry.ts. The concurrency cases against real
 * PostgreSQL are in scripts/order-expiry.integration.test.ts (verify cluster, cat_expiry_* scratch schema).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

process.env.SESSION_SECRET ??= "unit-test-session-secret-0123456789abcdef";

import {
  decideOrderExpiry, expireUnpaidOrder, readExpirySettings, runOrderExpiryTick, safeExpiryErrorCode, SELLER_EXPIRED_BODY,
  ORDER_EXPIRY_BATCH, ORDER_EXPIRED_AUDIT_ACTION, type ExpiryOrder,
} from "../lib/order-expiry";
import { createOrderExpiryLoop } from "../lib/order-expiry-loop";
import { shouldStartOrderExpiryLoop } from "../lib/order-expiry-runtime";
import { describeDbPool, dbPoolLogLine } from "../lib/db-pool-info";
import { buildTransactionalEmail, ORDER_EXPIRED_UNPAID_REASON } from "../lib/email-templates";
import { SETTING_KEYS, getSettingDefinition } from "../lib/settings/registry";
import { VENDOR_NOTIFICATION_TITLES, vendorNotificationHref } from "../lib/vendor-notifications";
import { transitionVendorStoreOrder } from "../lib/order-fulfillment";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const NOW = new Date("2026-11-20T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

// ---------------------------------------------------------------------------------------------------------------
// The rule

function order(overrides: Partial<ExpiryOrder> = {}): ExpiryOrder {
  return {
    status: "PENDING",
    createdAt: minutesAgo(61),
    payments: [{ id: "pay-1", status: "PENDING", providerReference: null }],
    storeOrders: [{ id: "so-1", status: "NEW", shipmentStatus: null, latestRequestStatus: null }],
    ...overrides,
  };
}

test("rule: an unpaid, untouched order older than N minutes expires", () => {
  assert.equal(decideOrderExpiry(order(), NOW, 60), "EXPIRE");
  assert.equal(decideOrderExpiry(order({ storeOrders: [{ id: "a", status: "NEW", shipmentStatus: null }, { id: "b", status: "PENDING", shipmentStatus: null }] }), NOW, 60), "EXPIRE");
  // One store order already cancelled, the other still open: the open one expires.
  assert.equal(decideOrderExpiry(order({ storeOrders: [{ id: "a", status: "CANCELLED", shipmentStatus: null }, { id: "b", status: "NEW", shipmentStatus: null }] }), NOW, 60), "EXPIRE");
  // Epoint said failed earlier: the attempt is FAILED, so it no longer blocks.
  assert.equal(decideOrderExpiry(order({ payments: [{ id: "p", status: "FAILED", providerReference: "trx-1" }, { id: "q", status: "PENDING", providerReference: null }] }), NOW, 60), "EXPIRE");
});

test("rule: never paid, confirmed, dispatched, young, requested, in-flight or claimed orders", () => {
  assert.equal(decideOrderExpiry(order({ createdAt: minutesAgo(59) }), NOW, 60), "TOO_YOUNG");
  for (const status of ["PAID", "AUTHORIZED", "REFUNDED"]) {
    assert.equal(decideOrderExpiry(order({ payments: [{ id: "p", status, providerReference: "trx" }] }), NOW, 60), "PAID", status);
  }
  for (const status of ["CONFIRMED", "PREPARING", "READY", "HANDED_TO_COURIER", "SHIPPED", "DELIVERED"]) {
    assert.equal(decideOrderExpiry(order({ storeOrders: [{ id: "a", status, shipmentStatus: null }] }), NOW, 60), "NOT_OPEN", status);
  }
  assert.equal(decideOrderExpiry(order({ storeOrders: [{ id: "a", status: "NEW", shipmentStatus: "SHIPPED" }] }), NOW, 60), "NOT_OPEN");
  assert.equal(decideOrderExpiry(order({ storeOrders: [{ id: "a", status: "NEW", shipmentStatus: null, latestRequestStatus: "REQUESTED" }] }), NOW, 60), "NOT_OPEN");
  assert.equal(decideOrderExpiry(order({ payments: [{ id: "p", status: "PENDING", providerReference: "claim:p" }] }), NOW, 60), "CLAIM_IN_PROGRESS");
  assert.equal(decideOrderExpiry(order({ payments: [{ id: "p", status: "PENDING", providerReference: "trx-123" }] }), NOW, 60), "PAYMENT_IN_FLIGHT");
  assert.equal(decideOrderExpiry(order({ status: "CANCELLED", storeOrders: [{ id: "a", status: "CANCELLED", shipmentStatus: null }] }), NOW, 60), "CLOSED");
});

// ---------------------------------------------------------------------------------------------------------------
// Settings

test("settings: OFF by default and on failure; minutes default 60, limits 15-4320; admin labels as approved", async () => {
  assert.deepEqual(await readExpirySettings(async () => undefined), { enabled: false, minutes: 60 });
  assert.deepEqual(await readExpirySettings(async () => { throw new Error("db down"); }), { enabled: false, minutes: 60 });
  assert.deepEqual(await readExpirySettings(async (key) => (key === SETTING_KEYS.ordersUnpaidExpiryEnabled ? "true" : 30)), { enabled: false, minutes: 30 }, "only boolean true switches it on");
  assert.deepEqual(await readExpirySettings(async (key) => (key === SETTING_KEYS.ordersUnpaidExpiryEnabled ? true : 14)), { enabled: true, minutes: 60 });
  assert.deepEqual(await readExpirySettings(async (key) => (key === SETTING_KEYS.ordersUnpaidExpiryEnabled ? true : 4321)), { enabled: true, minutes: 60 });
  assert.deepEqual(await readExpirySettings(async (key) => (key === SETTING_KEYS.ordersUnpaidExpiryEnabled ? true : 15)), { enabled: true, minutes: 15 });
  const toggle = getSettingDefinition("orders.unpaidExpiryEnabled")!;
  const minutes = getSettingDefinition("orders.unpaidExpiryMinutes")!;
  assert.equal(toggle.default, false);
  assert.equal(toggle.label, "Ödənilməmiş sifarişlərin avtomatik ləğvi");
  assert.equal(minutes.default, 60);
  assert.equal(minutes.label, "Ödəniş üçün gözləmə müddəti (dəqiqə)");
  assert.deepEqual(minutes.input, { kind: "integer", min: 15, max: 4320, unit: "dəqiqə" });
  assert.equal(toggle.group, "orders");
  assert.equal(toggle.permission, getSettingDefinition("orders.customerCancellationEnabled")!.permission);
});

// ---------------------------------------------------------------------------------------------------------------
// In-memory database running the real cancel path
/* eslint-disable @typescript-eslint/no-explicit-any -- a loose in-memory stand-in for Prisma's transaction client */

function makeDb(options: { createdAt?: Date; payments?: { id: string; status: string; providerReference: string | null }[]; storeStatus?: string; locked?: boolean; items?: { productId: string; inventoryId: string; quantity: number }[] } = {}) {
  const items = options.items ?? [{ productId: "prod-1", inventoryId: "inv-1", quantity: 2 }];
  const state = {
    orderStatus: "PENDING",
    storeStatus: options.storeStatus ?? "NEW",
    payments: (options.payments ?? [{ id: "pay-1", status: "PENDING", providerReference: null }]).map((row) => ({ ...row })),
    inventory: new Map(items.map((row) => [row.inventoryId, 5])),
    adjustments: [] as Array<{ inventoryId: string; delta: number; actorUserId: string; reason: string }>,
    lockCalls: [] as string[],
    audits: [] as Array<{ actorId: string | null; action: string; metadata: Record<string, unknown> }>,
    outbox: new Map<string, { template: string; recipient: string }>(),
    notifications: [] as Array<{ userId: string; title: string; body: string }>,
    locked: options.locked ?? false,
    findManyArgs: [] as unknown[],
    transactions: 0,
  };
  const storeOrder = () => ({ id: "so-1", orderId: "order-1", storeId: "store-1", status: state.storeStatus, shipmentStatus: null, order: { id: "order-1", payments: state.payments.map((p) => ({ status: p.status })) } });
  const tx: any = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes('FROM "Order"') && sql.includes("SKIP LOCKED")) { state.lockCalls.push("order"); return state.locked ? [] : [{ id: values[0] }]; }
      if (sql.includes('FROM "Inventory"')) { state.lockCalls.push(String(values[0])); return []; }
      return [];
    },
    order: {
      findUnique: async ({ select }: any) => {
        if (select?.payments) {
          return {
            id: "order-1", userId: "customer-1", status: state.orderStatus, createdAt: options.createdAt ?? minutesAgo(90),
            user: { email: "buyer@example.invalid" },
            payments: state.payments,
            storeOrders: [{ id: "so-1", storeId: "store-1", status: state.storeStatus, shipmentStatus: null, store: { name: "Mağaza", vendor: { user: { id: "seller-1", email: "seller@example.invalid" } } }, cancellationRequests: [] }],
          };
        }
        return { id: "order-1" };
      },
      update: async ({ data }: any) => { state.orderStatus = data.status; return { id: "order-1", status: state.orderStatus }; },
    },
    storeOrder: {
      findFirst: async () => storeOrder(),
      updateMany: async ({ where, data }: any) => { if (where.status !== state.storeStatus) return { count: 0 }; state.storeStatus = data.status; return { count: 1 }; },
      findMany: async () => [{ status: state.storeStatus }],
      findUnique: async () => ({ ...storeOrder(), items: [] }),
    },
    orderCancellationRequest: { count: async () => 0, updateMany: async () => ({ count: 0 }) },
    orderItem: { findMany: async () => items.map((row) => ({ productId: row.productId, variantId: null, quantity: row.quantity, product: { storeId: "store-1", variants: [] } })) },
    inventory: {
      findFirst: async ({ where }: any) => { const row = items.find((item) => item.productId === where.productId); return row ? { id: row.inventoryId } : null; },
      findUnique: async ({ where }: any) => ({ id: where.id, quantity: state.inventory.get(where.id) }),
      update: async ({ where, data }: any) => { state.inventory.set(where.id, state.inventory.get(where.id)! + data.quantity.increment); return { id: where.id, quantity: state.inventory.get(where.id) }; },
    },
    inventoryAdjustment: { create: async ({ data }: any) => { state.adjustments.push(data); return data; } },
    payment: { updateMany: async ({ where, data }: any) => { let count = 0; for (const p of state.payments) if (p.status === where.status && (where.providerReference === undefined || p.providerReference === where.providerReference)) { p.status = data.status; count++; } return { count }; } },
    auditLog: { create: async ({ data }: any) => { state.audits.push(data); return data; } },
    emailOutbox: { upsert: async ({ where, create }: any) => { if (!state.outbox.has(where.dedupeKey)) state.outbox.set(where.dedupeKey, { template: create.template, recipient: create.recipient }); return { id: where.dedupeKey }; } },
    notification: { create: async ({ data }: any) => { state.notifications.push(data); return data; } },
  };
  const db: any = {
    $transaction: async (fn: (t: any) => Promise<unknown>) => { state.transactions++; return fn(tx); },
    order: { findMany: async (args: unknown) => { state.findManyArgs.push(args); return [{ id: "order-1", payments: state.payments.map((p) => ({ ...p })) }]; } },
  };
  return { state, db, tx };
}

test("expire: cancels through the normal path, stock back once, customer as stock actor, system audit, messages once", async () => {
  const { state, db } = makeDb();
  const first = await expireUnpaidOrder(db, { orderId: "order-1", now: NOW, minutes: 60 });
  assert.deepEqual(first, { outcome: "EXPIRED", storeOrderIds: ["so-1"] });
  assert.equal(state.storeStatus, "CANCELLED");
  assert.equal(state.orderStatus, "CANCELLED");
  assert.equal(state.inventory.get("inv-1"), 7, "5 + 2 restored");
  assert.deepEqual(state.adjustments.map((row) => [row.delta, row.actorUserId]), [[2, "customer-1"]]);
  assert.equal(state.payments[0].status, "FAILED");
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].actorId, null);
  assert.equal(state.audits[0].action, ORDER_EXPIRED_AUDIT_ACTION);
  assert.deepEqual(Object.keys(state.audits[0].metadata).sort(), ["epointChecked", "expiryMinutes", "orderCreatedAt", "pendingPaymentsFailed", "storeOrderIds"]);
  assert.deepEqual([...state.outbox.values()].map((row) => row.template).sort(), ["ORDER_STATUS", "SELLER_ORDER_CANCELLED"]);
  assert.deepEqual(state.notifications, [{ userId: "seller-1", storeId: "store-1", title: "Sifariş ödənilmədiyi üçün ləğv edildi", body: SELLER_EXPIRED_BODY("order-1") }]);
  assert.equal(SELLER_EXPIRED_BODY("cmwp06dlt000eb7o8qd8rf4y3"), "Sifariş #QD8RF4Y3 ödəniş vaxtında tamamlanmadığı üçün avtomatik ləğv edildi. Stok bərpa edildi; sifarişi göndərməyin.");

  // Idempotent: a second run (another process, a slow tick) changes nothing.
  const second = await expireUnpaidOrder(db, { orderId: "order-1", now: NOW, minutes: 60 });
  assert.equal(second.outcome, "CLOSED");
  assert.equal(state.inventory.get("inv-1"), 7);
  assert.equal(state.audits.length, 1);
  assert.equal(state.outbox.size, 2);
});

test("expire: a locked order (someone paying or cancelling it now) is skipped; re-checks under the lock", async () => {
  const locked = makeDb({ locked: true });
  assert.equal((await expireUnpaidOrder(locked.db, { orderId: "order-1", now: NOW, minutes: 60 })).outcome, "LOCKED");
  assert.equal(locked.state.storeStatus, "NEW");
  assert.equal(locked.state.inventory.get("inv-1"), 5);
  const cases: [Parameters<typeof makeDb>[0], string][] = [
    [{ createdAt: minutesAgo(10) }, "TOO_YOUNG"],
    [{ payments: [{ id: "p", status: "PAID", providerReference: "trx" }] }, "PAID"],
    [{ storeStatus: "CONFIRMED" }, "NOT_OPEN"],
    [{ payments: [{ id: "p", status: "PENDING", providerReference: "claim:p" }] }, "CLAIM_IN_PROGRESS"],
    [{ payments: [{ id: "p", status: "PENDING", providerReference: "trx-9" }] }, "PAYMENT_IN_FLIGHT"],
  ];
  for (const [options, outcome] of cases) {
    const { state, db } = makeDb(options);
    assert.equal((await expireUnpaidOrder(db, { orderId: "order-1", now: NOW, minutes: 60 })).outcome, outcome);
    assert.equal(state.inventory.get("inv-1"), 5, `${outcome}: stock untouched`);
    assert.equal(state.audits.length, 0);
  }
});

test("lock order fix: the stock restore locks rows in inventory-id order; the restore is otherwise unchanged", async () => {
  const items = [{ productId: "prod-b", inventoryId: "inv-b", quantity: 1 }, { productId: "prod-a", inventoryId: "inv-a", quantity: 3 }];
  const { state, tx } = makeDb({ items });
  await transitionVendorStoreOrder(tx, { id: "so-1", storeId: "store-1", actorUserId: "seller-1", targetStatus: "CANCELLED" });
  assert.deepEqual(state.lockCalls, ["inv-a", "inv-b"], "same order as checkout (sorted by inventory id)");
  assert.equal(state.inventory.get("inv-a"), 8);
  assert.equal(state.inventory.get("inv-b"), 6);
  assert.deepEqual(state.adjustments.map((row) => [row.inventoryId, row.delta, row.reason]), [
    ["inv-a", 3, "Sifariş so-1 ləğv edildiyi üçün stok bərpa edildi"],
    ["inv-b", 1, "Sifariş so-1 ləğv edildiyi üçün stok bərpa edildi"],
  ]);
  // Checkout uses the same comparison.
  assert.match(read("app/api/orders/route.ts"), /normalized\.sort\(\(a:any,b:any\)=>a\.inventoryId\.localeCompare\(b\.inventoryId\)\)/);
  assert.match(read("lib/order-fulfillment.ts"), /lines\.sort\(\(a, b\) => a\.inventoryId\.localeCompare\(b\.inventoryId\)\);/);
});

// ---------------------------------------------------------------------------------------------------------------
// The tick

test("tick: OFF (default or failed read) touches nothing; Epoint not configured touches nothing", async () => {
  const { state, db } = makeDb();
  let remoteCalls = 0;
  const base = { db, epointConfigured: () => true, checkRemotePayment: async () => { remoteCalls++; return "FAILED" as const; }, now: () => NOW };
  assert.deepEqual(await runOrderExpiryTick({ ...base, readSetting: async () => undefined }), { state: "off" });
  assert.deepEqual(await runOrderExpiryTick({ ...base, readSetting: async () => { throw new Error("x"); } }), { state: "off" });
  assert.deepEqual(await runOrderExpiryTick({ ...base, epointConfigured: () => false, readSetting: async (key) => key === SETTING_KEYS.ordersUnpaidExpiryEnabled }), { state: "epoint_not_configured" });
  assert.equal(state.findManyArgs.length, 0);
  assert.equal(state.transactions, 0);
  assert.equal(remoteCalls, 0);
});

const on = async (key: string) => (key === SETTING_KEYS.ordersUnpaidExpiryEnabled ? true : 60);

test("tick: candidate query (oldest first, 20, cutoff, never-expirable payments left out) and expiry", async () => {
  const { state, db } = makeDb();
  const result = await runOrderExpiryTick({ db, readSetting: on, epointConfigured: () => true, checkRemotePayment: async () => "FAILED", now: () => NOW, excludeIds: ["skip-me"] });
  assert.equal(result.state, "ran");
  assert.equal(result.state === "ran" && result.expired, 1);
  assert.deepEqual(state.findManyArgs[0], {
    where: {
      status: "PENDING",
      createdAt: { lt: minutesAgo(60) },
      id: { notIn: ["skip-me"] },
      payments: { none: { OR: [{ status: { in: ["PAID", "AUTHORIZED", "REFUNDED"] } }, { status: "PENDING", providerReference: { startsWith: "claim:" } }] } },
    },
    orderBy: { createdAt: "asc" },
    take: ORDER_EXPIRY_BATCH,
    select: { id: true, payments: { select: { id: true, status: true, providerReference: true } } },
  });
  assert.equal(ORDER_EXPIRY_BATCH, 20);
});

test("tick: an Epoint attempt is asked first: success keeps the order, open/unknown skips, failed expires", async () => {
  const attempt = [{ id: "pay-1", status: "PENDING", providerReference: "trx-1" }];
  for (const [remote, expected] of [["PAID", "skippedPaid"], ["UNCHANGED", "skippedInFlight"], ["ERROR", "skippedInFlight"]] as const) {
    const { state, db } = makeDb({ payments: attempt });
    const result = await runOrderExpiryTick({ db, readSetting: on, epointConfigured: () => true, checkRemotePayment: async () => remote, now: () => NOW });
    assert.equal(result.state === "ran" && result[expected], 1, remote);
    assert.equal(state.transactions, 0, `${remote}: no expiry transaction`);
    assert.equal(state.inventory.get("inv-1"), 5);
    if (expected === "skippedInFlight") assert.deepEqual(result.state === "ran" && result.inFlightIds, ["order-1"]);
  }
  // Epoint said failed: the runtime's settlement made the payment FAILED; then the order expires.
  const { state, db } = makeDb({ payments: attempt });
  const result = await runOrderExpiryTick({ db, readSetting: on, epointConfigured: () => true, checkRemotePayment: async () => { state.payments[0].status = "FAILED"; return "FAILED"; }, now: () => NOW });
  assert.equal(result.state === "ran" && result.expired, 1);
  assert.equal(state.audits[0].metadata.epointChecked, true);
  assert.equal(state.inventory.get("inv-1"), 7);
});

test("tick: one order failing does not stop the tick; only safe codes are kept", async () => {
  const { db } = makeDb();
  db.$transaction = async () => { throw Object.assign(new Error("secret text order-1"), { code: "P2034" }); };
  const result = await runOrderExpiryTick({ db, readSetting: on, epointConfigured: () => true, checkRemotePayment: async () => "FAILED", now: () => NOW });
  assert.equal(result.state === "ran" && result.errors, 1);
  assert.deepEqual(result.state === "ran" && result.errorCodes, ["P2034"]);
  assert.equal(safeExpiryErrorCode(new Error("x")), "UNKNOWN");
  assert.equal(safeExpiryErrorCode({ code: "select * from x" }), "UNKNOWN");
  assert.equal(safeExpiryErrorCode({ code: "CONFLICT" }), "CONFLICT");
});

// ---------------------------------------------------------------------------------------------------------------
// Loop, runtime, messages

test("loop: never throws, one tick at a time, idle state logged once, counts only, in-flight back-off", async () => {
  const logs: string[] = [];
  const logger = { info: (line: string) => logs.push(line), error: (line: string) => logs.push(line) };
  let clock = 0;
  const excludes: (readonly string[])[] = [];
  const results: any[] = [{ state: "off" }, { state: "off" }, { state: "ran", minutes: 60, candidates: 2, expired: 1, skippedLocked: 0, skippedPaid: 0, skippedInFlight: 1, skippedClaim: 0, skippedOther: 0, errors: 0, errorCodes: [], inFlightIds: ["order-x"] }];
  const loop = createOrderExpiryLoop({ logger, now: () => clock, runTick: async (exclude) => { excludes.push(exclude); const next = results.shift(); if (!next) throw Object.assign(new Error("boom order-1"), { code: "P1001" }); return next; } });
  await loop.tick(); await loop.tick(); await loop.tick();
  assert.equal(logs.filter((line) => line.includes('"state":"off"')).length, 1, "idle state logged once");
  assert.deepEqual(JSON.parse(logs[1]), { event: "order_expiry", state: "ran", minutes: 60, candidates: 2, expired: 1, skipped_locked: 0, skipped_paid: 0, skipped_inflight: 1, skipped_claim: 0, skipped_other: 0, errors: 0 });
  await loop.tick();
  assert.deepEqual(excludes[3], ["order-x"], "an open Epoint attempt is left out for a while");
  assert.deepEqual(JSON.parse(logs[2]), { event: "order_expiry", state: "tick_failed", code: "P1001" });
  assert.doesNotMatch(logs.join("\n"), /order-1|boom/);
  clock += 31 * 60_000;
  results.push({ state: "off" });
  await loop.tick();
  assert.deepEqual(excludes[4], [], "back-off expires");
  // Concurrency in-process: a second tick while one runs returns null.
  let release!: () => void;
  const slow = createOrderExpiryLoop({ logger, runTick: () => new Promise((resolve) => { release = () => resolve({ state: "off" }); }) });
  const first = slow.tick();
  assert.equal(await slow.tick(), null);
  release(); await first;
});

test("loop start: timers are unref'd; runtime starts only on the Node server with Epoint configured", () => {
  const scheduled: number[] = [];
  let unref = 0;
  const loop = createOrderExpiryLoop({ runTick: async () => ({ state: "off" }), setTimer: (_callback, ms) => { scheduled.push(ms); return { unref: () => { unref++; } }; }, clearTimer: () => undefined });
  loop.start(); loop.start();
  assert.deepEqual(scheduled, [60_000]);
  assert.equal(unref, 1);
  loop.stop();
  const epoint = { EPOINT_PAYMENTS_ENABLED: "1", EPOINT_ENVIRONMENT: "sandbox", EPOINT_PUBLIC_KEY: "pk", EPOINT_PRIVATE_KEY: "sk", EPOINT_CREATE_PAYMENT_URL: "https://epoint.example/create", EPOINT_STATUS_URL: "https://epoint.example/status", APP_BASE_URL: "https://shop.example" };
  assert.equal(shouldStartOrderExpiryLoop({ NEXT_RUNTIME: "nodejs" }), false, "no Epoint: no timer at all");
  assert.equal(shouldStartOrderExpiryLoop({ ...epoint, NEXT_RUNTIME: "edge" }), false);
  assert.equal(shouldStartOrderExpiryLoop({ ...epoint, NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-build" }), false);
  assert.equal(shouldStartOrderExpiryLoop({ ...epoint, NEXT_RUNTIME: "nodejs" }), true);
  const instrumentation = read("instrumentation.ts");
  assert.match(instrumentation, /const \{ readEpointConfig \} = await import\("\.\/lib\/payments\/epoint-config"\);\n\s+if \(readEpointConfig\(process\.env\)\) \{\n\s+const \{ startOrderExpiryLoop \} = await import\("\.\/lib\/order-expiry-runtime"\);/);
  assert.doesNotMatch(instrumentation, /^import /m);
});

test("messages: customer email gets the reason line only for an expiry; seller notification links to orders", () => {
  const expired = buildTransactionalEmail("ORDER_STATUS", { orderRef: "order-1", storeName: "BAGATI", status: "CANCELLED", reason: ORDER_EXPIRED_UNPAID_REASON }, "BAGATI <no-reply@example.invalid>", "buyer@example.invalid", "<m@example.invalid>");
  const normal = buildTransactionalEmail("ORDER_STATUS", { orderRef: "order-1", storeName: "BAGATI", status: "CANCELLED" }, "BAGATI <no-reply@example.invalid>", "buyer@example.invalid", "<m@example.invalid>");
  assert.match(String(expired.text), /Ödəniş vaxtında tamamlanmadığı üçün sifariş avtomatik ləğv edildi\./);
  assert.doesNotMatch(String(normal.text), /Ödəniş vaxtında/);
  assert.equal(String(normal.text), String(expired.text).replace("\n\nÖdəniş vaxtında tamamlanmadığı üçün sifariş avtomatik ləğv edildi.", ""));
  assert.equal(VENDOR_NOTIFICATION_TITLES.orderExpiredUnpaid, "Sifariş ödənilmədiyi üçün ləğv edildi");
  assert.equal(vendorNotificationHref("store-1", VENDOR_NOTIFICATION_TITLES.orderExpiredUnpaid, true), "/vendor/store-1/orders");
});

test("scope: the expiry reuses the cancel path; order creation and payment code are untouched by it", () => {
  const expiry = read("lib/order-expiry.ts");
  assert.match(expiry, /await cancelStoreOrderLocked\(tx, \{ id: storeOrder\.id, storeId: storeOrder\.storeId, actorUserId: order\.userId \}\);/);
  assert.match(expiry, /FOR UPDATE SKIP LOCKED/);
  assert.doesNotMatch(expiry, /inventory\.(update|updateMany)|quantity: \{ increment/, "no stock code of its own");
  const runtime = read("lib/order-expiry-runtime.ts");
  assert.match(runtime, /await requestEpointStatus\(config, payment\.providerReference, transport\)/);
  assert.match(runtime, /await settleVerifiedEpointResult\(/);
});

// ---------------------------------------------------------------------------------------------------------------
// A9

test("A9 pool log line: only connection_limit and pool_timeout, never any other part of the URL", () => {
  const url = "postgresql://shopuser:S3cr3t-P%40ss@db.internal.example:5432/bagati_prod?schema=public&connection_limit=10&pool_timeout=10&sslmode=require";
  const line = dbPoolLogLine({ DATABASE_URL: url }, 4);
  assert.deepEqual(JSON.parse(line), { event: "db_pool", connection_limit: "10", pool_timeout: "10", source: "DATABASE_URL", cpus: 4 });
  for (const secret of ["shopuser", "S3cr3t", "db.internal", "5432", "bagati_prod", "public", "sslmode", "require", "postgresql"]) assert.ok(!line.includes(secret), secret);
  assert.deepEqual(describeDbPool({ DATABASE_URL: "postgresql://u:p@h:5432/d?schema=public" }, 4), { connectionLimit: "default", poolTimeout: "default", source: "default", cpus: 4 });
  assert.deepEqual(describeDbPool({}, 2), { connectionLimit: "default", poolTimeout: "default", source: "default", cpus: 2 });
  assert.deepEqual(describeDbPool({ DATABASE_URL: "not a url with password hunter2" }, 2), { connectionLimit: "default", poolTimeout: "default", source: "unreadable", cpus: 2 });
  // Odd values are not echoed back.
  assert.equal(describeDbPool({ DATABASE_URL: "postgresql://u:p@h/d?connection_limit=10;DROP&pool_timeout=abc" }, 1).connectionLimit, "default");
  assert.match(read("instrumentation.ts"), /console\.info\(dbPoolLogLine\(process\.env\)\);/);
});
