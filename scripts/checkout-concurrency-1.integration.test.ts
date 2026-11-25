/**
 * CHECKOUT-CONCURRENCY-1 on real PostgreSQL with TRULY CONCURRENT requests to a running production build.
 *
 * Every scenario fires its POST /api/orders requests at the same moment (Promise.all) against CC1_BASE_URL and then
 * checks the database. Scenarios (each with its own fresh store / products / customers under a random tag):
 *   (a) throughput: N = 10, 25, 50 customers, different products, same store      -> 201/409 counts (+ target <= 1 % 409)
 *   (b) I1 oversell: stock 5, 20 simultaneous buyers of one product               -> exactly 5 orders, stock 0
 *   (c) I2 double submit: one customer, 5 simultaneous requests (and 2 tabs)       -> exactly 1 order, rest CART_EMPTY
 *   (d) I7 deadlock: two carts with the same 2 products in opposite order, 10 runs -> 2 x 201 every run, no 500
 *   (e) I3 price / campaign change mid-checkout and before checkout                -> agreed price or PRICE_CHANGED
 *   (f) I5 store paused before checkout (refused) and mid-checkout (consistent)
 *   (g) I4 multi-store cart: one order with 2 store orders; a stock failure in one store rolls back everything
 * Mid-checkout cases are deterministic: a separate connection holds the product's stock row lock, waits until the
 * checkout is blocked on it (pg_stat_activity), makes the change, then releases the lock.
 *
 * Safety: database only through BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, name contains
 * "verify") with BAGATI_VERIFY_SCHEMA = an already-migrated cat_* scratch schema (never migrates). The server must be a
 * localhost build started with the same schema and the same SESSION_SECRET (sessions are signed here exactly like
 * lib/auth.ts createSession). Skips (NOT VERIFIED) without CC1_BASE_URL / the cluster / the schema.
 *   CC1_SCENARIOS=a,b,...   run only these scenarios (default: all)
 *   CC1_RECORD_ONLY=1       record (a) counts without asserting the <= 1 % target (the "before" run on main)
 *   CC1_OUT=<file>          write the measured numbers as JSON
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { LEGAL_VERSIONS } from "../lib/legal-versions";

function guarded(): { url: string; base: string; secret: Uint8Array } | { refuse: string } | { skip: string } {
  const raw = process.env.BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL;
  if (!raw) return { skip: "verify database URL is not set" };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { refuse: "the verify URL is not a valid URL" }; }
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return { refuse: "verify database host must be loopback" };
  if (parsed.port !== "5433") return { refuse: "verify database port must be exactly 5433" };
  if (!decodeURIComponent(parsed.pathname).includes("verify")) return { refuse: "verify database name must contain \"verify\"" };
  const schema = process.env.BAGATI_VERIFY_SCHEMA;
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (needs a migrated cat_* scratch schema)" };
  if (!/^cat_[a-z0-9_]{1,40}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be a cat_* scratch schema" };
  const base = process.env.CC1_BASE_URL;
  if (!base) return { skip: "CC1_BASE_URL is not set (needs a running localhost build)" };
  const host = new URL(base).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return { refuse: "CC1_BASE_URL must be localhost" };
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return { skip: "SESSION_SECRET (same as the server) is not set" };
  parsed.searchParams.set("schema", schema);
  return { url: parsed.toString(), base: base.replace(/\/$/, ""), secret: new TextEncoder().encode(secret) };
}

const guard = guarded();
const only = new Set((process.env.CC1_SCENARIOS ?? "a,b,c,d,e,f,g").split(",").map((s) => s.trim()));
const recordOnly = process.env.CC1_RECORD_ONLY === "1";
const results: Record<string, unknown> = {};
let db: PrismaClient | null = null;

async function client(t: { skip: (message: string) => void }): Promise<PrismaClient | null> {
  if ("skip" in guard) { t.skip(`NOT VERIFIED: ${guard.skip}`); return null; }
  if ("refuse" in guard) throw new Error(`refusing: ${guard.refuse}`);
  if (!db) {
    db = new PrismaClient({ datasources: { db: { url: guard.url } } });
    const [where] = await db.$queryRaw<{ port: number; schema: string; db: string }[]>`SELECT inet_server_port() AS port, current_schema() AS schema, current_database() AS db`;
    if (Number(where.port) !== 5433 || where.schema !== process.env.BAGATI_VERIFY_SCHEMA || !where.db.includes("verify")) throw new Error(`refusing: ${JSON.stringify(where)}`);
  }
  return db;
}
const g = () => guard as { url: string; base: string; secret: Uint8Array };

// ------------------------------------------------------------------------------------------------- fixtures
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
let shared: { cityId: string; categoryId: string; planId: string } | null = null;
async function base(p: PrismaClient) {
  if (shared) return shared;
  const tag = randomUUID().slice(0, 8);
  const city = await p.city.create({ data: { name: `Bakı ${tag}`, slug: `baki-${tag}` } });
  const category = await p.category.create({ data: { name: `Kateqoriya ${tag}`, slug: `cat-${tag}`, sortOrder: 10 } });
  const plan = await p.subscriptionPlan.create({ data: { name: `Pro ${tag}`, slug: "pro", monthlyPrice: 49 } }).catch(async () => p.subscriptionPlan.findFirstOrThrow({ where: { slug: "pro" } }));
  shared = { cityId: city.id, categoryId: category.id, planId: plan.id };
  return shared;
}
async function makeStore(p: PrismaClient, opts: { deliveryFee?: number; threshold?: number; commission?: number } = {}) {
  const b = await base(p); const tag = randomUUID().slice(0, 8);
  const seller = await p.user.create({ data: { email: `seller-${tag}@cc1.invalid`, passwordHash: "x", role: "VENDOR", emailVerifiedAt: new Date(), vendorProfile: { create: { displayName: `Mağaza ${tag}`, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: `Satıcı ${tag}`, voen: String(1_000_000_000 + Math.floor(Math.random() * 8_999_999_999)).slice(0, 10), legalAddress: "Bakı" } } }, include: { vendorProfile: true } });
  const store = await p.store.create({ data: { vendorId: seller.vendorProfile!.id, cityId: b.cityId, name: `Mağaza ${tag}`, slug: `store-${tag}`, status: "ACTIVE", origin: "SELLER_SUBMITTED", isActive: true, legalInfoApproved: true, deliveryFee: opts.deliveryFee ?? 4, freeDeliveryThreshold: opts.threshold ?? 100,
    subscription: { create: { planId: b.planId, status: "ACTIVE", startedAt: hoursAgo(480), currentPeriodStart: hoursAgo(480), currentPeriodEnd: hoursAgo(-240), accessSource: "ADMIN_MANUAL" } } } });
  if (opts.commission !== undefined) await p.commission.create({ data: { storeId: store.id, rate: opts.commission, startsAt: hoursAgo(48) } });
  return store;
}
async function makeProducts(p: PrismaClient, storeId: string, count: number, stock: number, price = 10) {
  const b = await base(p); const out = [];
  for (let i = 0; i < count; i++) {
    const tag = randomUUID().slice(0, 8);
    out.push(await p.product.create({ data: { storeId, categoryId: b.categoryId, sku: `CC1-${tag}`, name: `Məhsul ${tag}`, slug: `p-${tag}`, price, status: "ACTIVE", images: ["/images/categories/home.webp"], inventory: { create: { quantity: stock, lowStockThreshold: 0 } } }, include: { inventory: true } }));
  }
  return out;
}
type Customer = { id: string; addressId: string; token: string; cartItems: { id: string }[] };
async function makeCustomer(p: PrismaClient, cart: { productId: string; quantity: number }[]): Promise<Customer> {
  const b = await base(p); const tag = randomUUID().slice(0, 8);
  const user = await p.user.create({ data: { email: `buyer-${tag}@cc1.invalid`, passwordHash: "x", role: "CUSTOMER", emailVerifiedAt: new Date(), customerProfile: { create: { firstName: "Test", lastName: "Alıcı" } } } });
  await p.legalAcceptance.create({ data: { userId: user.id, document: "CUSTOMER_TERMS", version: LEGAL_VERSIONS.CUSTOMER_TERMS, source: "REGISTER_EMAIL" } });
  const address = await p.address.create({ data: { userId: user.id, cityId: b.cityId, recipientName: "Test Alıcı", phone: "+994501234567", line1: "Test küçəsi 1", isDefault: true } });
  const created = await p.cart.create({ data: { userId: user.id, items: { create: cart } }, include: { items: true } });
  const sessionId = randomUUID(), expiresAt = new Date(Date.now() + 3_600_000);
  await p.authSession.create({ data: { id: sessionId, userId: user.id, expiresAt } });
  const token = await new SignJWT({ sub: user.id, jti: sessionId }).setProtectedHeader({ alg: "HS256" }).setIssuer("bagati").setAudience("bagati-session").setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime() / 1000)).sign(g().secret);
  return { id: user.id, addressId: address.id, token, cartItems: created.items };
}
type OrderResult = { status: number; code: string | null; orderId: string | null };
async function order(customer: { addressId: string; token: string }, expectedPrices?: { cartItemId: string; unitPrice: number }[]): Promise<OrderResult> {
  const response = await fetch(`${g().base}/api/orders`, { method: "POST", headers: { "content-type": "application/json", origin: g().base, cookie: `bagati_session=${customer.token}` }, body: JSON.stringify({ addressId: customer.addressId, ...(expectedPrices ? { expectedPrices } : {}) }) });
  const body = await response.json().catch(() => null) as { order?: { id: string }; code?: string } | null;
  return { status: response.status, code: body?.code ?? null, orderId: body?.order?.id ?? null };
}
const tally = (rows: { status: number; code: string | null }[]) => rows.reduce<Record<string, number>>((acc, r) => { const key = r.status === 201 ? "201" : `${r.status} ${r.code}`; acc[key] = (acc[key] ?? 0) + 1; return acc; }, {});

/** Holds a FOR UPDATE lock on one stock row until release() is called; waitForBlockedCheckout() resolves when a checkout waits on it. */
async function holdStockRow(p: PrismaClient, inventoryId: string) {
  type Change = ((tx: Prisma.TransactionClient) => Promise<unknown>) | undefined;
  let release!: (change: Change) => void; const released = new Promise<Change>((resolve) => { release = resolve; });
  let locked!: () => void; const isLocked = new Promise<void>((resolve) => { locked = resolve; });
  const done = p.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Inventory" WHERE "id" = ${inventoryId} FOR UPDATE`; locked();
    const change = await released;
    if (change) await change(tx); // e.g. another buyer takes the last unit: committed together with the release
  }, { timeout: 30_000, maxWait: 10_000 });
  await isLocked;
  return {
    release: async (change?: Change) => { release(change); await done; },
    waitForBlockedCheckout: async () => {
      for (let i = 0; i < 200; i++) {
        const [row] = await p.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM "Inventory" WHERE "id"%FOR UPDATE%'`;
        if (row.n > 0) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error("the checkout never reached the stock-row lock");
    },
  };
}
const orderCheck = async (p: PrismaClient, orderId: string) => {
  const o = await p.order.findUniqueOrThrow({ where: { id: orderId }, include: { storeOrders: { include: { items: true } }, payments: true } });
  let subtotal = new Prisma.Decimal(0), fees = new Prisma.Decimal(0);
  for (const so of o.storeOrders) {
    const lines = so.items.reduce((s, i) => s.add(i.lineTotal), new Prisma.Decimal(0));
    assert.ok(lines.eq(so.subtotal), "store subtotal = sum of lines");
    for (const i of so.items) assert.ok(i.unitPrice.mul(i.quantity).eq(i.lineTotal), "line = unit x qty");
    subtotal = subtotal.add(so.subtotal); fees = fees.add(so.deliveryFee);
  }
  assert.ok(o.subtotal.eq(subtotal) && o.deliveryFee.eq(fees) && o.total.eq(subtotal.add(fees)), "order totals");
  assert.equal(o.payments.length, 1); assert.equal(o.payments[0].status, "PENDING"); assert.ok(o.payments[0].amount.eq(o.total));
  return o;
};

// ------------------------------------------------------------------------------------------------- scenarios
test("(a) throughput: N customers, different products, same store, all at once", { skip: !only.has("a") }, async (t) => {
  const p = await client(t); if (!p) return;
  const out: Record<string, Record<string, number>> = {}; let total = 0, conflicts = 0;
  for (const n of [10, 25, 50]) {
    const store = await makeStore(p, { commission: 0.1 });
    const products = await makeProducts(p, store.id, n, 50, 12.5);
    const customers: Customer[] = [];
    for (const product of products) customers.push(await makeCustomer(p, [{ productId: product.id, quantity: 1 }]));
    const rows: OrderResult[] = await Promise.all(customers.map((c) => order(c)));
    out[`N=${n}`] = tally(rows); total += n; conflicts += rows.filter((r) => r.status === 409).length;
    assert.equal(rows.filter((r) => r.status >= 500).length, 0, "no 5xx");
    for (const [i, r] of rows.entries()) {
      const inventory: { quantity: number } = await p.inventory.findFirstOrThrow({ where: { productId: products[i].id } });
      if (r.status === 201) {
        const o = await orderCheck(p, r.orderId!);
        assert.equal(o.storeOrders.length, 1); assert.equal(Number(o.storeOrders[0].commissionRateSnapshot), 0.1, "commission snapshot");
        assert.equal(Number(o.storeOrders[0].deliveryFee), 4, "delivery fee below the free threshold");
        assert.equal(inventory.quantity, 49);
        assert.equal(await p.cartItem.count({ where: { cart: { userId: customers[i].id } } }), 0);
      } else {
        assert.equal(inventory.quantity, 50, "a refused order leaves stock untouched");
        assert.equal(await p.order.count({ where: { userId: customers[i].id } }), 0);
        assert.equal(await p.cartItem.count({ where: { cart: { userId: customers[i].id } } }), 1, "a refused order leaves the cart");
      }
    }
  }
  results.a = { counts: out, total, conflicts, conflictRate: +(conflicts / total).toFixed(3) };
  if (!recordOnly) assert.ok(conflicts <= Math.floor(total * 0.01), `409 rate ${conflicts}/${total} exceeds 1 %`);
});

test("(b) I1 no oversell: stock 5, 20 simultaneous buyers of one product -> exactly 5 orders", { skip: !only.has("b") }, async (t) => {
  const p = await client(t); if (!p) return;
  const store = await makeStore(p);
  const [product] = await makeProducts(p, store.id, 1, 5);
  const customers: Customer[] = [];
  for (let i = 0; i < 20; i++) customers.push(await makeCustomer(p, [{ productId: product.id, quantity: 1 }]));
  const rows = await Promise.all(customers.map((c) => order(c)));
  const inventory = await p.inventory.findFirstOrThrow({ where: { productId: product.id } });
  results.b = { counts: tally(rows), stockLeft: inventory.quantity };
  assert.equal(rows.filter((r) => r.status === 201).length, 5);
  assert.equal(rows.filter((r) => r.status === 409).length, 15);
  for (const r of rows.filter((x) => x.status === 409)) assert.ok(["STOCK_CHANGED", "VARIANT_OUT_OF_STOCK", "TRANSACTION_CONFLICT"].includes(r.code!), r.code!);
  assert.equal(inventory.quantity, 0); assert.equal(inventory.reserved, 0);
  assert.equal(await p.orderItem.count({ where: { productId: product.id } }), 5);
  assert.equal(await p.inventoryAdjustment.count({ where: { inventoryId: inventory.id } }), 5);
});

test("(c) I2 double submit: one cart, 5 simultaneous requests (and 2 tabs) -> exactly one order", { skip: !only.has("c") }, async (t) => {
  const p = await client(t); if (!p) return;
  const store = await makeStore(p);
  const products = await makeProducts(p, store.id, 2, 10);
  const out: Record<string, unknown> = {};
  for (const [label, parallel] of [["5 requests", 5], ["2 tabs", 2]] as const) {
    const customer = await makeCustomer(p, products.map((x) => ({ productId: x.id, quantity: 1 })));
    const before: { id: string; quantity: number }[] = await p.inventory.findMany({ where: { productId: { in: products.map((x) => x.id) } } });
    const rows = await Promise.all(Array.from({ length: parallel }, () => order(customer)));
    out[label] = tally(rows);
    assert.equal(rows.filter((r) => r.status === 201).length, 1);
    for (const r of rows.filter((x) => x.status !== 201)) { assert.equal(r.status, 409); assert.equal(r.code, "CART_EMPTY"); }
    assert.equal(await p.order.count({ where: { userId: customer.id } }), 1);
    const after: { id: string; quantity: number }[] = await p.inventory.findMany({ where: { productId: { in: products.map((x) => x.id) } } });
    for (const row of after) assert.equal(row.quantity, before.find((x) => x.id === row.id)!.quantity - 1, "stock taken once");
  }
  results.c = out;
});

test("(d) I7 no deadlock: two carts with the same products in opposite order, 10 simultaneous runs", { skip: !only.has("d") }, async (t) => {
  const p = await client(t); if (!p) return;
  const store = await makeStore(p);
  const [a, b] = await makeProducts(p, store.id, 2, 1000);
  const x = await makeCustomer(p, []), y = await makeCustomer(p, []);
  const runs: Record<string, number>[] = [];
  for (let run = 0; run < 10; run++) {
    const cartX = await p.cart.findUniqueOrThrow({ where: { userId: x.id } }), cartY = await p.cart.findUniqueOrThrow({ where: { userId: y.id } });
    await p.cartItem.create({ data: { cartId: cartX.id, productId: a.id, quantity: 1 } }); await p.cartItem.create({ data: { cartId: cartX.id, productId: b.id, quantity: 1 } });
    await p.cartItem.create({ data: { cartId: cartY.id, productId: b.id, quantity: 1 } }); await p.cartItem.create({ data: { cartId: cartY.id, productId: a.id, quantity: 1 } });
    const rows = await Promise.all([order(x), order(y)]);
    runs.push(tally(rows));
    assert.deepEqual(rows.map((r) => r.status), [201, 201], `run ${run}: ${JSON.stringify(rows)}`);
  }
  const stock = await p.inventory.findMany({ where: { productId: { in: [a.id, b.id] } } });
  for (const row of stock) assert.equal(row.quantity, 1000 - 20);
  results.d = { runs: runs.length, allCreated: runs.every((r) => r["201"] === 2) };
});

test("(e) I3 price and campaign changes: before checkout -> PRICE_CHANGED; mid-checkout -> the agreed price, consistent totals", { skip: !only.has("e") }, async (t) => {
  const p = await client(t); if (!p) return;
  const store = await makeStore(p);
  const out: Record<string, unknown> = {};
  // Before: the price changes after the customer saw 10.00 -> refused, nothing written.
  {
    const [product] = await makeProducts(p, store.id, 1, 10, 10);
    const c = await makeCustomer(p, [{ productId: product.id, quantity: 2 }]);
    await p.product.update({ where: { id: product.id }, data: { price: 15 } });
    const r = await order(c, [{ cartItemId: c.cartItems[0].id, unitPrice: 10 }]);
    out.priceBefore = r; assert.equal(r.status, 409); assert.equal(r.code, "PRICE_CHANGED");
    assert.equal((await p.inventory.findFirstOrThrow({ where: { productId: product.id } })).quantity, 10);
  }
  // Mid-checkout: the price changes while the checkout waits on the stock lock (after it read prices) -> the agreed price.
  {
    const [product] = await makeProducts(p, store.id, 1, 10, 10);
    const c = await makeCustomer(p, [{ productId: product.id, quantity: 2 }]);
    const hold = await holdStockRow(p, product.inventory[0].id);
    const pending = order(c, [{ cartItemId: c.cartItems[0].id, unitPrice: 10 }]);
    await hold.waitForBlockedCheckout();
    await p.product.update({ where: { id: product.id }, data: { price: 15 } });
    await hold.release();
    const r = await pending; out.priceMid = r;
    assert.equal(r.status, 201);
    const o = await orderCheck(p, r.orderId!);
    assert.equal(Number(o.storeOrders[0].items[0].unitPrice), 10, "the price the customer agreed to");
    assert.equal(Number(o.total), 10 * 2 + 4);
  }
  // Campaign: activated before checkout -> PRICE_CHANGED; activated mid-checkout -> the agreed (non-campaign) price.
  for (const when of ["before", "mid"] as const) {
    const [product] = await makeProducts(p, store.id, 1, 10, 20);
    const c = await makeCustomer(p, [{ productId: product.id, quantity: 1 }]);
    const activate = () => p.promotion.create({ data: { storeId: store.id, name: `Kampaniya ${when}`, startsAt: hoursAgo(1), endsAt: hoursAgo(-24), isActive: true, discountType: "PERCENT", discountValue: 50, products: { create: [{ productId: product.id }] } } });
    let r;
    if (when === "before") { await activate(); r = await order(c, [{ cartItemId: c.cartItems[0].id, unitPrice: 20 }]); }
    else {
      const hold = await holdStockRow(p, product.inventory[0].id);
      const pending = order(c, [{ cartItemId: c.cartItems[0].id, unitPrice: 20 }]);
      await hold.waitForBlockedCheckout(); await activate(); await hold.release(); r = await pending;
    }
    out[`campaign-${when}`] = r;
    if (when === "before") { assert.equal(r.status, 409); assert.equal(r.code, "PRICE_CHANGED"); }
    else { assert.equal(r.status, 201); const o = await orderCheck(p, r.orderId!); assert.equal(Number(o.storeOrders[0].items[0].unitPrice), 20); }
  }
  results.e = out;
});

test("(f) I5 store paused: before checkout -> refused; mid-checkout -> consistent (order before the pause)", { skip: !only.has("f") }, async (t) => {
  const p = await client(t); if (!p) return;
  const out: Record<string, unknown> = {};
  {
    const store = await makeStore(p);
    const [product] = await makeProducts(p, store.id, 1, 10);
    const c = await makeCustomer(p, [{ productId: product.id, quantity: 1 }]);
    await p.store.update({ where: { id: store.id }, data: { status: "SUSPENDED", isActive: false } });
    const r = await order(c); out.before = r;
    assert.equal(r.status, 409); assert.equal(r.code, "STORE_UNAVAILABLE");
    assert.equal((await p.inventory.findFirstOrThrow({ where: { productId: product.id } })).quantity, 10);
  }
  {
    const store = await makeStore(p);
    const [product] = await makeProducts(p, store.id, 1, 10);
    const c = await makeCustomer(p, [{ productId: product.id, quantity: 1 }]);
    const hold = await holdStockRow(p, product.inventory[0].id);
    const pending = order(c);
    await hold.waitForBlockedCheckout();
    await p.store.update({ where: { id: store.id }, data: { status: "SUSPENDED", isActive: false } });
    await hold.release();
    const r = await pending; out.mid = r;
    // Eligibility was checked (store active) before the pause committed: the order is serialised before the pause,
    // exactly as Serializable allowed. Either way it must be whole and consistent.
    assert.ok(r.status === 201 || (r.status === 409 && r.code === "STORE_UNAVAILABLE"), JSON.stringify(r));
    if (r.status === 201) await orderCheck(p, r.orderId!);
  }
  results.f = out;
});

test("(g) I4 multi-store cart: one order with two store orders; a stock failure in one store rolls back everything", { skip: !only.has("g") }, async (t) => {
  const p = await client(t); if (!p) return;
  const s1 = await makeStore(p, { deliveryFee: 4, threshold: 100 }), s2 = await makeStore(p, { deliveryFee: 3, threshold: 5 });
  const [p1] = await makeProducts(p, s1.id, 1, 10, 10), [p2] = await makeProducts(p, s2.id, 1, 1, 10);
  const out: Record<string, unknown> = {};
  // Success: one order, two store orders, per-store delivery (store 2 is above its free threshold).
  {
    const [q1] = await makeProducts(p, s1.id, 1, 10, 10), [q2] = await makeProducts(p, s2.id, 1, 10, 10);
    const c = await makeCustomer(p, [{ productId: q1.id, quantity: 1 }, { productId: q2.id, quantity: 1 }]);
    const r = await order(c); out.success = r;
    assert.equal(r.status, 201);
    const o = await orderCheck(p, r.orderId!);
    assert.equal(o.storeOrders.length, 2);
    assert.deepEqual(o.storeOrders.map((so) => Number(so.deliveryFee)).sort(), [0, 4]);
  }
  // Failure: the last unit of p2 is taken while the checkout holds p1's lock -> STOCK_CHANGED, nothing written.
  {
    const c = await makeCustomer(p, [{ productId: p1.id, quantity: 1 }, { productId: p2.id, quantity: 1 }]);
    const hold = await holdStockRow(p, p2.inventory[0].id);
    const pending = order(c);
    await hold.waitForBlockedCheckout();
    await hold.release((tx) => tx.inventory.update({ where: { id: p2.inventory[0].id }, data: { quantity: 0 } }));
    const r = await pending; out.rollback = r;
    if (r.status === 201) throw new Error("expected a stock failure");
    assert.equal(r.status, 409);
    assert.equal(await p.order.count({ where: { userId: c.id } }), 0, "no partial order");
    assert.equal((await p.inventory.findFirstOrThrow({ where: { productId: p1.id } })).quantity, 10, "no stock leak in the other store");
    assert.equal(await p.cartItem.count({ where: { cart: { userId: c.id } } }), 2, "cart intact");
  }
  results.g = out;
});

test.after(async () => {
  if (process.env.CC1_OUT) writeFileSync(process.env.CC1_OUT, JSON.stringify(results, null, 1));
  await db?.$disconnect();
});
