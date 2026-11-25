/**
 * ORDER-NOTIFY-1: customer progress e-mails (one hook in the one status-change function) and the per-store
 * "Təhvil aldım" confirmation. Hook events for every status x source, exactly-once dedupe, a failing e-mail never
 * blocks the status change, the confirmation rules for every OrderStatus, 404 for others, idempotency, no status
 * change, templates (no payment/price/time words), migration (additive, IF NOT EXISTS, LF, last), texts, untouched
 * admin/legal files. Live check on 5433: see the report.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { enqueueEmail } from "../lib/email-outbox";
import { stableEmailDedupeKey } from "../lib/email-outbox-core";
import { buildTransactionalEmail, EMAIL_TEMPLATES } from "../lib/email-templates";
import { customerOrderNumber, ORDER_PROGRESS_STATUSES, orderProgressEvent, orderProgressEventKey, orderProgressPayload, queueOrderProgressEmail, usableCustomerEmail, type StatusChangeSource } from "../lib/order-progress-emails";
import { confirmStoreOrderReceipt, OrderReceiptError, RECEIPT_ALLOWED_STATUSES, receiptAllowed } from "../lib/order-receipt";
import { transitionVendorStoreOrder } from "../lib/order-fulfillment";
import { ORDER_NOTIFY_TEXT } from "../lib/order-notify-text";
import { SELLER_PANEL_3_REUSED, SELLER_PANEL_3_TEXT } from "../lib/seller-panel-3";
import { VENDOR_NOTIFICATION_TITLES, vendorNotificationHref } from "../lib/vendor-notifications";
import { AUDIT_ACTION_LABELS } from "../lib/audit-action-labels";
import { ADMIN_DESIGN_1_FILES, withoutAdminDesign1 } from "./admin-design-1-scope";

process.env.EMAIL_ENCRYPTION_KEY = "a".repeat(64);
const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const BASE = "07ae7c7";
const baseFile = (path: string) => { try { return execFileSync("git", ["show", `${BASE}:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).replace(/\r\n/g, "\n"); } catch { return ""; } };
const ORDER_STATUSES = read("prisma/schema.prisma").match(/enum OrderStatus \{([^}]*)\}/)![1].split(/\s+/).filter(Boolean);
const SHIPMENT_STATUSES = read("prisma/schema.prisma").match(/enum ShipmentStatus \{([^}]*)\}/)![1].split(/\s+/).filter(Boolean);
const SOURCES: StatusChangeSource[] = ["STORE", "ADMIN", "CUSTOMER_CANCEL", "STORE_APPROVED_CANCEL_REQUEST", "UNPAID_EXPIRY"];
const ORDER_ID = "cmwuxn36p0018b7i4yzbd6r5w";

// ---------------------------------------------------------------- hook: events

test("hook events: every from x to x source; only the store's own change e-mails, only the 4 events", () => {
  assert.ok(ORDER_STATUSES.length === 11);
  const expected: Record<string, string | null> = { CONFIRMED: "CONFIRMED", HANDED_TO_COURIER: "ON_THE_WAY", SHIPPED: "ON_THE_WAY", DELIVERED: "DELIVERED", CANCELLED: "CANCELLED" };
  for (const source of SOURCES) for (const from of ORDER_STATUSES) for (const to of ORDER_STATUSES) {
    const want = source === "STORE" && from !== to ? expected[to] ?? null : null;
    assert.equal(orderProgressEvent(from, to, source), want, `${source} ${from}->${to}`);
  }
  for (const silent of ["PENDING", "NEW", "PREPARING", "READY", "PROCESSING", "RETURNED"]) assert.equal(orderProgressEvent("CONFIRMED", silent, "STORE"), null, silent);
  assert.deepEqual([...ORDER_PROGRESS_STATUSES].sort(), ["CANCELLED", "CONFIRMED", "DELIVERED", "HANDED_TO_COURIER", "SHIPPED"]);
  assert.equal(orderProgressEventKey("so1", "ON_THE_WAY"), "order-progress:so1:ON_THE_WAY");
  assert.equal(customerOrderNumber(ORDER_ID), "#YZBD6R5W");
});

test("usable customer e-mail: plain single address only", () => {
  assert.equal(usableCustomerEmail(" buyer@example.az "), "buyer@example.az");
  for (const bad of [null, undefined, "", "  ", "no-at", "a@b", "a b@c.az", "a@b.az,c@d.az", "<a@b.az>", "x".repeat(250) + "@b.az"]) assert.equal(usableCustomerEmail(bad as string), null, String(bad));
});

// ---------------------------------------------------------------- hook: queue, dedupe, never blocks

type Row = { dedupeKey: string; recipient: string; template: string };
function fakeTx(opts: { email?: string | null; storeOrders?: Record<string, { orderId: string; store: string }>; outbox?: Map<string, Row>; failEnqueue?: boolean; failFind?: boolean } = {}) {
  const sql: string[] = [];
  const outbox = opts.outbox ?? new Map<string, Row>();
  const storeOrders = opts.storeOrders ?? { so1: { orderId: ORDER_ID, store: "Gözəl Çiçək" } };
  const tx = {
    sql, outbox,
    $executeRawUnsafe: async (query: string) => { sql.push(query); return 0; },
    storeOrder: { findUnique: async ({ where }: { where: { id: string } }) => {
      if (opts.failFind) throw new Error("db down");
      const row = storeOrders[where.id];
      return row ? { id: where.id, orderId: row.orderId, store: { name: row.store }, order: { user: opts.email === null ? null : { email: opts.email ?? "buyer@example.az" } } } : null;
    } },
    emailOutbox: { upsert: async ({ where, create }: { where: { dedupeKey: string }; create: Row }) => {
      if (opts.failEnqueue) throw new Error("unique violation");
      if (!outbox.has(where.dedupeKey)) outbox.set(where.dedupeKey, { dedupeKey: create.dedupeKey, recipient: create.recipient, template: create.template });
      return { id: "x" };
    } },
  };
  return tx;
}
const quiet = { log: () => undefined };

test("hook queues inside a savepoint with the dedupe key, template and payload (store name, number, link)", async () => {
  const tx = fakeTx();
  let captured: Parameters<typeof enqueueEmail>[1] | null = null;
  const result = await queueOrderProgressEmail(tx as never, { storeOrderId: "so1", fromStatus: "NEW", targetStatus: "CONFIRMED", source: "STORE" }, { enqueue: async (_c, input) => { captured = input; }, ...quiet });
  assert.equal(result, "QUEUED");
  assert.deepEqual(tx.sql, ["SAVEPOINT order_progress_email", "RELEASE SAVEPOINT order_progress_email"]);
  assert.equal(captured!.eventKey, "order-progress:so1:CONFIRMED");
  assert.equal(captured!.template, "CUSTOMER_ORDER_PROGRESS");
  assert.equal(captured!.recipient, "buyer@example.az");
  assert.equal(captured!.payload.storeName, "Gözəl Çiçək");
  assert.equal(captured!.payload.orderRef, "#YZBD6R5W");
  assert.equal(captured!.payload.event, "CONFIRMED");
});

test("exactly once per (store order, event): repeats, HANDED_TO_COURIER then SHIPPED, back-and-forth -> one row each", async () => {
  const outbox = new Map<string, Row>();
  const tx = fakeTx({ outbox, storeOrders: { so1: { orderId: ORDER_ID, store: "A" }, so2: { orderId: ORDER_ID, store: "B" } } });
  const run = (storeOrderId: string, from: string, to: string) => queueOrderProgressEmail(tx as never, { storeOrderId, fromStatus: from, targetStatus: to, source: "STORE" }, quiet);
  await run("so1", "NEW", "CONFIRMED"); await run("so1", "NEW", "CONFIRMED");
  await run("so1", "READY", "HANDED_TO_COURIER"); await run("so1", "HANDED_TO_COURIER", "SHIPPED");
  await run("so1", "HANDED_TO_COURIER", "DELIVERED"); await run("so1", "RETURNED", "DELIVERED");
  await run("so2", "NEW", "CANCELLED");
  const keys = [...outbox.keys()];
  assert.equal(keys.length, 4, "so1 x3 events + so2 x1");
  for (const [id, event] of [["so1", "CONFIRMED"], ["so1", "ON_THE_WAY"], ["so1", "DELIVERED"], ["so2", "CANCELLED"]]) {
    assert.ok(outbox.has(stableEmailDedupeKey(`order-progress:${id}:${event}`)), `${id} ${event}`);
  }
  for (const row of outbox.values()) assert.equal(row.template, "CUSTOMER_ORDER_PROGRESS");
});

test("a failing e-mail never blocks: enqueue or lookup error -> rollback to the savepoint, FAILED, no throw", async () => {
  const lines: string[] = [];
  for (const opts of [{ failEnqueue: true }, { failFind: true }]) {
    const tx = fakeTx(opts);
    const result = await queueOrderProgressEmail(tx as never, { storeOrderId: "so1", fromStatus: "READY", targetStatus: "HANDED_TO_COURIER", source: "STORE" }, { log: (line) => lines.push(line) });
    assert.equal(result, "FAILED");
    assert.deepEqual(tx.sql, ["SAVEPOINT order_progress_email", "ROLLBACK TO SAVEPOINT order_progress_email"]);
  }
  assert.ok(lines.every((line) => line.includes("order_progress_email.queue_failed") && !line.includes("@")), "logged, no address");
  // Missing encryption key: payload encryption throws inside the savepoint -> FAILED as well.
  const saved = process.env.EMAIL_ENCRYPTION_KEY; const session = process.env.SESSION_SECRET;
  process.env.EMAIL_ENCRYPTION_KEY = ""; delete process.env.SESSION_SECRET;
  try { assert.equal(await queueOrderProgressEmail(fakeTx() as never, { storeOrderId: "so1", fromStatus: "NEW", targetStatus: "CONFIRMED", source: "STORE" }, quiet), "FAILED"); }
  finally { process.env.EMAIL_ENCRYPTION_KEY = saved; if (session !== undefined) process.env.SESSION_SECRET = session; }
});

test("no usable customer e-mail: skipped silently with a log line (no address), nothing queued", async () => {
  for (const email of [null, "", "not-an-address"]) {
    const lines: string[] = [];
    const tx = fakeTx({ email });
    assert.equal(await queueOrderProgressEmail(tx as never, { storeOrderId: "so1", fromStatus: "NEW", targetStatus: "CONFIRMED", source: "STORE" }, { log: (line) => lines.push(line) }), "NO_EMAIL");
    assert.equal(tx.outbox.size, 0);
    assert.match(lines[0], /order_progress_email\.skipped_no_email/);
  }
  assert.equal(await queueOrderProgressEmail(fakeTx() as never, { storeOrderId: "so1", fromStatus: "NEW", targetStatus: "CONFIRMED", source: "ADMIN" }, quiet), "NO_EVENT");
});

test("the real status change commits even when the progress e-mail fails (transitionVendorStoreOrder)", async () => {
  const sql: string[] = [];
  let status = "NEW";
  const tx = {
    $queryRaw: async () => [], $executeRawUnsafe: async (query: string) => { sql.push(query); return 0; },
    storeOrder: {
      findFirst: async () => ({ id: "so1", orderId: ORDER_ID, storeId: "st1", status, order: { id: ORDER_ID, payments: [{ status: "PENDING" }] } }),
      updateMany: async ({ data }: { data: { status: string } }) => { status = data.status; return { count: 1 }; },
      findMany: async () => [{ status }],
      findUnique: async (args: { include?: unknown; select?: unknown }) => { if (args.select) throw new Error("db down"); return { id: "so1", status, items: [] }; },
    },
    order: { update: async () => ({}) },
    emailOutbox: { upsert: async () => { throw new Error("boom"); } },
    orderCancellationRequest: { count: async () => 0 },
  };
  const result = await transitionVendorStoreOrder(tx as never, { id: "so1", storeId: "st1", actorUserId: "u1", targetStatus: "CONFIRMED" });
  assert.equal(status, "CONFIRMED");
  assert.equal(result.item?.status, "CONFIRMED");
  assert.deepEqual(sql, ["SAVEPOINT order_progress_email", "ROLLBACK TO SAVEPOINT order_progress_email"]);
});

test("one central hook: called once in applyStoreOrderTransition; every caller names its source", () => {
  const fulfillment = read("lib/order-fulfillment.ts");
  assert.equal(fulfillment.match(/queueOrderProgressEmail\(/g)?.length, 1);
  assert.match(fulfillment, /if \(updated\.count !== 1\) throw new OrderFulfillmentError\("CONFLICT"\);\n {2}\/\/ ORDER-NOTIFY-1[^\n]*\n {2}await queueOrderProgressEmail\(tx, \{ storeOrderId: storeOrder\.id, fromStatus: storeOrder\.status, targetStatus: input\.targetStatus, source: input\.source \}\);/);
  assert.match(fulfillment, /return applyStoreOrderTransition\(tx, \{ \.\.\.input, source: "STORE" \}\);/);
  assert.match(fulfillment, /targetStatus: input\.targetStatus,\n {6}source: "ADMIN",/);
  assert.match(read("lib/order-cancellation-service.ts"), /actorUserId: input\.customerId, source: "CUSTOMER_CANCEL" \}/);
  assert.match(read("lib/order-cancellation-service.ts"), /actorUserId: input\.actorUserId, source: "STORE_APPROVED_CANCEL_REQUEST" \}/);
  assert.match(read("lib/order-expiry.ts"), /actorUserId: order\.userId, source: "UNPAID_EXPIRY" \}/);
  // No other code writes a store order status.
  for (const path of ["app", "lib"].flatMap((dir) => execFileSync("git", ["ls-files", dir], { cwd: root, encoding: "utf8" }).split(/\r?\n/)).filter((path) => /\.tsx?$/.test(path) && !/\.test\./.test(path))) {
    const source = read(path);
    if (path === "lib/order-fulfillment.ts") continue;
    assert.doesNotMatch(source, /storeOrder\.(update|updateMany)\(\{[^)]*data:\s*\{[^}]*\bstatus:/, path);
  }
  // The seller route keeps its generic status e-mail only for the statuses without their own progress e-mail.
  assert.match(read("app/api/vendor/[storeId]/[section]/route.ts"), /if\(targetOrderStatus&&targetOrderStatus!==locked\.status&&!\(ORDER_PROGRESS_STATUSES as readonly string\[\]\)\.includes\(targetOrderStatus\)\)\{/);
});

// ---------------------------------------------------------------- templates

const MAIL = (template: "CUSTOMER_ORDER_PROGRESS" | "SELLER_CUSTOMER_CONFIRMED", payload: Record<string, string>) => buildTransactionalEmail(template, payload, "BAGATI <noreply@shopbagati.com>", "to@example.az", "m1");
const FORBIDDEN = /ödəniş|ödən|ödə |kart|AZN|₼|məbləğ|qiymət|pulsuz|endirim|saat|dəqiqə|gün ərzində|sabah|tezliklə|reytinq|ulduz/i;

test("customer templates: subject per event, store + number + link, the receipt hint only for on-the-way/delivered, no payment/price/time words", () => {
  assert.ok((EMAIL_TEMPLATES as readonly string[]).includes("CUSTOMER_ORDER_PROGRESS") && (EMAIL_TEMPLATES as readonly string[]).includes("SELLER_CUSTOMER_CONFIRMED"));
  const subjects: Record<string, string> = { CONFIRMED: ORDER_NOTIFY_TEXT.confirmedSubject, ON_THE_WAY: ORDER_NOTIFY_TEXT.onTheWaySubject, DELIVERED: ORDER_NOTIFY_TEXT.deliveredSubject, CANCELLED: ORDER_NOTIFY_TEXT.cancelledSubject };
  for (const event of ["CONFIRMED", "ON_THE_WAY", "DELIVERED", "CANCELLED"] as const) {
    const payload = orderProgressPayload({ event, orderId: ORDER_ID, storeName: "Gözəl Çiçək Şüşə Ağacı" }, "https://shopbagati.com");
    const mail = MAIL("CUSTOMER_ORDER_PROGRESS", payload as Record<string, string>);
    assert.equal(mail.subject, subjects[event]);
    const text = String(mail.text);
    assert.match(text, /Sifariş #YZBD6R5W — Gözəl Çiçək Şüşə Ağacı\./);
    assert.match(text, /Sifarişə bax: https:\/\/shopbagati\.com\/orders\/cmwuxn36p0018b7i4yzbd6r5w/);
    assert.equal(text.includes("“Təhvil aldım”"), event === "ON_THE_WAY" || event === "DELIVERED", event);
    assert.doesNotMatch(`${mail.subject}\n${text}`, FORBIDDEN, event);
    for (const letter of ["ə", "ı", "ö", "ü", "ğ", "ş", "ç"]) assert.ok(`${mail.subject}${text}${mail.html}`.includes(letter) || letter === "x", letter);
    assert.match(String(mail.html), /<html lang="az">/);
  }
  const hostile = MAIL("CUSTOMER_ORDER_PROGRESS", orderProgressPayload({ event: "CONFIRMED", orderId: ORDER_ID, storeName: "<script>x</script>\nBcc: x@y.az" }, "https://shopbagati.com") as Record<string, string>);
  assert.doesNotMatch(String(hostile.html), /<script>/, "store name escaped");
  assert.doesNotMatch(String(hostile.subject), /\n/);
  // No base URL: no link, the rest unchanged.
  assert.doesNotMatch(String(MAIL("CUSTOMER_ORDER_PROGRESS", orderProgressPayload({ event: "CONFIRMED", orderId: ORDER_ID, storeName: "A" }, undefined) as Record<string, string>).text), /Sifarişə bax/);
});

test("seller template: subject, store + number, status note, panel link; no customer data or money", () => {
  const mail = MAIL("SELLER_CUSTOMER_CONFIRMED", { storeName: "Ev Dünyası", orderRef: "YZBD6R5W", panelUrl: "https://shopbagati.com/vendor/st1/orders/so1" });
  assert.equal(mail.subject, "Alıcı təhvil aldığını təsdiqlədi");
  assert.match(String(mail.text), /^Ev Dünyası: sifariş №YZBD6R5W\.\n\nAlıcı sifarişi təhvil aldığını təsdiqlədi\.\n\nBu təsdiq sifarişin statusunu dəyişmir\.\n\nSifarişlərə bax: https:\/\/shopbagati\.com\/vendor\/st1\/orders\/so1$/);
  assert.doesNotMatch(String(mail.text), FORBIDDEN);
});

// ---------------------------------------------------------------- "Təhvil aldım": rules

test("receipt allowed: every OrderStatus x shipment status", () => {
  assert.deepEqual([...RECEIPT_ALLOWED_STATUSES], ["HANDED_TO_COURIER", "SHIPPED", "DELIVERED"]);
  for (const status of ORDER_STATUSES) for (const shipmentStatus of [null, ...SHIPMENT_STATUSES]) {
    const want = ["HANDED_TO_COURIER", "SHIPPED", "DELIVERED"].includes(status) && shipmentStatus !== "RETURNED";
    assert.equal(receiptAllowed({ status, shipmentStatus }), want, `${status}/${shipmentStatus}`);
  }
});

type ReceiptState = { owner: string; orderId: string; storeOrderId: string; status: string; shipmentStatus: string | null; confirmedAt: Date | null };
function fakeReceiptDb(state: ReceiptState) {
  const writes = { updates: [] as Record<string, unknown>[], audits: 0, notifications: [] as { title: string; body: string }[], locks: 0 };
  const tx = {
    order: { findFirst: async ({ where }: { where: { id: string; userId: string } }) => (where.id === state.orderId && where.userId === state.owner ? { id: state.orderId } : null) },
    $queryRaw: async () => { writes.locks += 1; return []; },
    storeOrder: {
      findFirst: async ({ where }: { where: { id: string; orderId: string } }) => (where.id === state.storeOrderId && where.orderId === state.orderId
        ? { id: state.storeOrderId, storeId: "st1", status: state.status, shipmentStatus: state.shipmentStatus, customerConfirmedAt: state.confirmedAt, store: { name: "Ev Dünyası", vendor: { user: { id: "seller1", email: "seller@example.az" } } } } : null),
      updateMany: async ({ where, data }: { where: { customerConfirmedAt: null }; data: { customerConfirmedAt: Date } }) => {
        writes.updates.push(data);
        if (where.customerConfirmedAt === null && state.confirmedAt === null) { state.confirmedAt = data.customerConfirmedAt; return { count: 1 }; }
        return { count: 0 };
      },
      findUnique: async () => ({ customerConfirmedAt: state.confirmedAt }),
    },
    auditLog: { create: async () => { writes.audits += 1; return {}; } },
    notification: { create: async ({ data }: { data: { title: string; body: string } }) => { writes.notifications.push(data); return {}; } },
  };
  const db = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx), emailOutbox: {}, store: {} };
  return { db, writes };
}

test("receipt: first confirmation sets only customerConfirmedAt, one audit row, one notification, one seller e-mail job", async () => {
  const state: ReceiptState = { owner: "c1", orderId: ORDER_ID, storeOrderId: "so1", status: "HANDED_TO_COURIER", shipmentStatus: "SHIPPED", confirmedAt: null };
  const { db, writes } = fakeReceiptDb(state);
  const jobs: unknown[] = [];
  const now = new Date("2026-11-25T10:00:00.000Z");
  const first = await confirmStoreOrderReceipt(db as never, { customerId: "c1", orderId: ORDER_ID, storeOrderId: "so1", now }, { queueSellerEmails: async (job) => { jobs.push(job); } });
  assert.deepEqual(first, { storeOrderId: "so1", confirmedAt: now, alreadyConfirmed: false });
  assert.deepEqual(writes.updates, [{ customerConfirmedAt: now }], "only the new column; status untouched");
  assert.equal(state.status, "HANDED_TO_COURIER");
  assert.equal(writes.locks, 1, "parent order row locked");
  assert.equal(writes.audits, 1);
  assert.deepEqual(writes.notifications, [{ userId: "seller1", storeId: "st1", title: "Alıcı təhvil aldığını təsdiqlədi", body: "Sifariş #YZBD6R5W: alıcı təhvil aldığını təsdiqlədi." }]);
  assert.equal(jobs.length, 1);
  // Idempotent: same time back, nothing new.
  const second = await confirmStoreOrderReceipt(db as never, { customerId: "c1", orderId: ORDER_ID, storeOrderId: "so1", now: new Date("2026-11-26T10:00:00.000Z") }, { queueSellerEmails: async (job) => { jobs.push(job); } });
  assert.deepEqual(second, { storeOrderId: "so1", confirmedAt: now, alreadyConfirmed: true });
  assert.equal(writes.audits, 1); assert.equal(writes.notifications.length, 1); assert.equal(jobs.length, 1); assert.equal(writes.updates.length, 1);
});

test("receipt: another customer, another order or an unknown store order -> NOT_FOUND; every disallowed status -> NOT_ALLOWED", async () => {
  const base: ReceiptState = { owner: "c1", orderId: ORDER_ID, storeOrderId: "so1", status: "SHIPPED", shipmentStatus: null, confirmedAt: null };
  const code = async (state: ReceiptState, input: { customerId: string; orderId: string; storeOrderId: string }) => {
    try { await confirmStoreOrderReceipt(fakeReceiptDb(state).db as never, input, { queueSellerEmails: async () => undefined }); return "OK"; }
    catch (error) { assert.ok(error instanceof OrderReceiptError); return error.code; }
  };
  assert.equal(await code({ ...base }, { customerId: "c2", orderId: ORDER_ID, storeOrderId: "so1" }), "NOT_FOUND");
  assert.equal(await code({ ...base }, { customerId: "c1", orderId: "other-order", storeOrderId: "so1" }), "NOT_FOUND");
  assert.equal(await code({ ...base }, { customerId: "c1", orderId: ORDER_ID, storeOrderId: "so-other" }), "NOT_FOUND");
  for (const status of ORDER_STATUSES) {
    const want = ["HANDED_TO_COURIER", "SHIPPED", "DELIVERED"].includes(status) ? "OK" : "NOT_ALLOWED";
    assert.equal(await code({ ...base, status }, { customerId: "c1", orderId: ORDER_ID, storeOrderId: "so1" }), want, status);
  }
  assert.equal(await code({ ...base, status: "DELIVERED", shipmentStatus: "RETURNED" }, { customerId: "c1", orderId: ORDER_ID, storeOrderId: "so1" }), "NOT_ALLOWED");
  // Already confirmed earlier and the order later RETURNED: still answers with the stored time (no new writes).
  const earlier = new Date("2026-11-20T09:00:00.000Z");
  const { db, writes } = fakeReceiptDb({ ...base, status: "RETURNED", confirmedAt: earlier });
  assert.deepEqual(await confirmStoreOrderReceipt(db as never, { customerId: "c1", orderId: ORDER_ID, storeOrderId: "so1" }), { storeOrderId: "so1", confirmedAt: earlier, alreadyConfirmed: true });
  assert.equal(writes.updates.length + writes.audits + writes.notifications.length, 0);
});

test("receipt route: CSRF first, customer only, rate limit, 404 / 409 mapping, no status change", () => {
  const route = read("app/api/orders/[orderId]/store-orders/[storeOrderId]/receipt/route.ts");
  const order = ["csrfRejection(request)", 'requireRole("CUSTOMER")', "withinFormRateLimits(", "confirmStoreOrderReceipt("].map((needle) => route.indexOf(needle));
  assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])), "CSRF -> auth -> rate limit -> action");
  assert.match(route, /scope: "order-receipt", identity: `user:\$\{customer\.id\}`, \.\.\.ORDER_RECEIPT_RATE_LIMIT/);
  assert.match(route, /error\.code === "NOT_FOUND"\) return NextResponse\.json\(\{ error: "Sifariş tapılmadı" \}, \{ status: 404 \}\)/);
  assert.match(route, /error\.code === "NOT_ALLOWED"\) return NextResponse\.json\(\{ error: ORDER_NOTIFY_TEXT\.receiptNotAllowed \}, \{ status: 409 \}\)/);
  const service = read("lib/order-receipt.ts");
  assert.match(service, /tx\.storeOrder\.updateMany\(\{ where: \{ id: storeOrder\.id, customerConfirmedAt: null \}, data: \{ customerConfirmedAt: confirmedAt \} \}\)/);
  assert.equal(service.match(/storeOrder\.update(Many)?\(/g)?.length, 1, "the only store-order write sets customerConfirmedAt (never the status)");
  assert.match(read("lib/form-rate-limit.ts"), /export const ORDER_RECEIPT_RATE_LIMIT = \{ limit: 30, windowMs: 10 \* 60 \* 1000 \}/);
});

test("seller side: notification title routes to orders; audit label; seller page shows the confirmation time", () => {
  assert.equal(VENDOR_NOTIFICATION_TITLES.customerConfirmedReceipt, ORDER_NOTIFY_TEXT.sellerConfirmed);
  assert.equal(vendorNotificationHref("st1", ORDER_NOTIFY_TEXT.sellerConfirmed, true), "/vendor/st1/orders");
  assert.equal((AUDIT_ACTION_LABELS as Record<string, string>).ORDER_RECEIPT_CONFIRMED, "Alıcı təhvil aldığını təsdiqlədi");
  const page = read("app/vendor/[storeId]/orders/[storeOrderId]/page.tsx");
  assert.match(page, /\{order\.customerConfirmedAt && <p data-customer-confirmed=""/);
  assert.match(page, /\{ORDER_NOTIFY_TEXT\.sellerConfirmed\} · <time dateTime=\{order\.customerConfirmedAt\.toISOString\(\)\} className="tabular-nums">\{formatOrderDateTime\(order\.customerConfirmedAt\)\}<\/time>/);
  const customer = read("app/(customer)/orders/[orderId]/page.tsx");
  assert.match(customer, /\{\(receiptAllowed\(group\)\|\|group\.customerConfirmedAt\)&&<div data-order-receipt-row=""/);
  const button = read("components/order-receipt-button.tsx");
  assert.match(button, /min-h-11/);
  assert.match(button, /formatOrderDateTime\(confirmed\)/);
});

// ---------------------------------------------------------------- migration, texts, untouched files

const MIGRATION = "prisma/migrations/20261125120000_store_order_customer_confirmed/migration.sql";
test("migration: additive, IF NOT EXISTS, nullable TIMESTAMP(3), LF (working copy and committed), sorts last; schema matches", () => {
  const raw = readFileSync(join(root, MIGRATION), "utf8");
  assert.doesNotMatch(raw, /\r/, "LF");
  try { assert.doesNotMatch(execFileSync("git", ["show", `HEAD:${MIGRATION}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }), /\r/, "committed LF"); } catch { /* not committed yet */ }
  const statements = raw.split("\n").filter((line) => line.trim() && !line.startsWith("--"));
  assert.deepEqual(statements, ['ALTER TABLE "StoreOrder" ADD COLUMN IF NOT EXISTS "customerConfirmedAt" TIMESTAMP(3);']);
  assert.doesNotMatch(statements.join("\n"), /DROP|RENAME|ALTER COLUMN|UPDATE |DELETE|NOT NULL|DEFAULT/i);
  const folders = readdirSync(join(root, "prisma/migrations")).filter((name) => /^\d{14}_/.test(name)).sort();
  assert.equal(folders.at(-1), "20261125120000_store_order_customer_confirmed");
  assert.match(read("prisma/schema.prisma"), /\n {2}customerConfirmedAt {4}DateTime\?\n/);
});

test("texts: the only new Azerbaijani text is ORDER_NOTIFY_TEXT (plus the owner's notification title and audit label)", () => {
  const changed = execFileSync("git", ["diff", "--name-only", BASE, "--", "app", "components", "lib"], { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean)
    .concat(["lib/order-progress-emails.ts", "lib/order-receipt.ts", "lib/order-notify-text.ts", "components/order-receipt-button.tsx", "app/api/orders/[orderId]/store-orders/[storeOrderId]/receipt/route.ts"]);
  const AZ = /[əğıöşüçƏĞİÖŞÜÇ]/;
  const fragments = (source: string) => new Set(source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*|\{\/\*)/.test(line)).join("\n").split(/["'`<>{}]|\$\{/).map((part) => part.trim()).filter((part) => AZ.test(part)));
  const approved = new Set<string>();
  for (const value of Object.values(ORDER_NOTIFY_TEXT)) for (const part of fragments(`"${typeof value === "function" ? value("X") : value}"`)) approved.add(part);
  for (const part of fragments("`Sifariş #${orderRef}: alıcı təhvil aldığını təsdiqlədi.`")) approved.add(part);
  approved.add("Alıcı təhvil aldığını təsdiqlədi");
  // SELLER-PANEL-3: texts the owner approved later ("mətnlər ok") plus reused existing wording (pinned in its own test).
  for (const value of [...Object.values(SELLER_PANEL_3_TEXT), ...Object.values(SELLER_PANEL_3_REUSED)]) for (const part of fragments(`"${typeof value === "function" ? value("X") : value}"`)) approved.add(part);
  for (const reused of ["Məhsul məlumatları yüklənir…", "Endirimli qiymət əsas qiymətdən aşağı olmalıdır."]) approved.add(reused);
  // The two halves of the approved T6 sentence around `${name}` in its template literal.
  for (const piece of ["Məlumatlar “", "” məhsulundan köçürüldü. Məhsul kodları və stok boş saxlanıldı; yadda saxlayana qədər heç nə yaradılmır."]) approved.add(piece);
  const added = [...new Set(changed)].flatMap((path) => { const before = fragments(baseFile(path)); return [...fragments(read(path))].filter((part) => !before.has(part) && !approved.has(part)).map((part) => `${path}: ${part}`); });
  // Fragments that are pieces of the approved e-mail lines (template literals split around ${...}).
  const allowedPieces = ["— ", "Sifariş", ": sifariş №", "Sifariş #", "Sifarişə bax", "Sifarişlərə bax", "Sifariş tapılmadı", "Əməliyyat uğursuz oldu.", "Mağaza", "Daxil olmaq tələb olunur"];
  // Reused pieces must already exist in main (fallback store name, error texts, link labels).
  for (const [piece, source] of [["Mağaza", "lib/email-templates.ts"], ["Daxil olmaq tələb olunur", "app/api/orders/[orderId]/cancel/route.ts"], ["Sifariş tapılmadı", "app/api/vendor/[storeId]/[section]/route.ts"], ["Əməliyyat uğursuz oldu.", "components/vendor-section.tsx"], ["Sifarişə bax", "app/(customer)/orders/page.tsx"], ["Sifarişlərə bax", "lib/email-templates.ts"]]) assert.ok(baseFile(source).includes(piece), `${piece} in ${source}`);
  assert.deepEqual(added.filter((line) => !allowedPieces.some((piece) => line.endsWith(`: ${piece}`))), []);
  assert.equal(Object.keys(ORDER_NOTIFY_TEXT).length, 19, "the texts table lists these 19 entries");
});

test("admin UI and legal pages untouched since main", () => {
  // ADMIN-DESIGN-1 (owner-approved, visual only) may change its listed admin UI files; everything else stays as in main.
  const diff = withoutAdminDesign1(execFileSync("git", ["diff", "--name-only", BASE, "--", "app/admin", "components/admin-ui", "app/(customer)/terms", "app/(customer)/privacy", "app/(customer)/seller-terms"], { cwd: root, encoding: "utf8" }).trim());
  assert.equal(diff, "");
  for (const name of readdirSync(join(root, "components")).filter((n) => n.startsWith("admin") && n.endsWith(".tsx") && !ADMIN_DESIGN_1_FILES.has(`components/${n}`))) assert.equal(read(`components/${name}`), baseFile(`components/${name}`), name);
});
