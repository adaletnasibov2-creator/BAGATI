/**
 * SCALE-FIX-4 B5 against the isolated verification PostgreSQL cluster: real row locks, real compare-and-set, real
 * Prisma queries (including the candidate query of the tick), concurrency with a second expiry, with the customer's own
 * cancel and with a held Order lock (a payment start), plus the cancel lock-order fix (no deadlock).
 *
 * Safety: uses ONLY BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL and refuses unless the host is loopback, the port is
 * exactly 5433 and the database name contains "verify". BAGATI_VERIFY_SCHEMA must name a cat_expiry_* scratch schema with
 * all migrations applied; without it the test skips. Never reads .env, never connects to 5432, never applies migrations.
 * Rows are tagged; the scratch schema is dropped after the run.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const VERIFY_URL_ENV = "BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL";

function guardedVerifyUrl(): { url: string } | { refuse: string } | { skip: string } {
  const raw = process.env[VERIFY_URL_ENV];
  if (!raw) return { skip: `${VERIFY_URL_ENV} is not set` };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { refuse: `${VERIFY_URL_ENV} is not a valid URL` }; }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return { refuse: "verify database host must be loopback" };
  if (parsed.port !== "5433") return { refuse: "verify database port must be exactly 5433" };
  if (!database.includes("verify")) return { refuse: "verify database name must contain \"verify\"" };
  const schema = process.env.BAGATI_VERIFY_SCHEMA;
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (a migrated cat_expiry_* scratch schema is required)" };
  if (!/^cat_expiry_[a-z0-9_]{1,50}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be a plain cat_expiry_* schema name" };
  parsed.searchParams.set("schema", schema);
  parsed.searchParams.set("connection_limit", "8");
  return { url: parsed.toString() };
}

test("unpaid-order expiry on real PostgreSQL", { timeout: 240_000 }, async (t) => {
  const guard = guardedVerifyUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  process.env.DATABASE_URL = guard.url;
  process.env.SESSION_SECRET ??= "bagati-isolated-order-expiry-integration-secret-0123";
  delete process.env.EMAIL_ENCRYPTION_KEY;

  const { expireUnpaidOrder, runOrderExpiryTick, ORDER_EXPIRED_AUDIT_ACTION } = await import("../lib/order-expiry");
  const { cancelOrderByCustomer } = await import("../lib/order-cancellation-service");
  const { transitionVendorStoreOrder } = await import("../lib/order-fulfillment");
  const { SETTING_KEYS } = await import("../lib/settings/registry");

  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const where: Array<{ db: string; port: number; schema: string }> = await prisma.$queryRaw`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`;
  assert.ok(where[0].db.includes("verify"));
  assert.equal(Number(where[0].port), 5433);
  assert.match(where[0].schema, /^cat_expiry_/);

  const tag = randomUUID().replace(/-/g, "").slice(0, 10);
  const now = new Date();
  const old = new Date(now.getTime() - 120 * 60_000);
  const city = await prisma.city.create({ data: { name: `Bakı ${tag}`, slug: `baki-${tag}` } });
  const customer = await prisma.user.create({ data: { email: `buyer-${tag}@verify.invalid`, passwordHash: "x", role: "CUSTOMER", emailVerifiedAt: now } });
  const seller = await prisma.user.create({ data: { email: `seller-${tag}@verify.invalid`, passwordHash: "x", role: "VENDOR", emailVerifiedAt: now, vendorProfile: { create: { displayName: "Satıcı" } } }, include: { vendorProfile: true } });
  const store = await prisma.store.create({ data: { vendorId: seller.vendorProfile!.id, cityId: city.id, name: "Test mağaza", slug: `store-${tag}`, status: "ACTIVE", isActive: true } });
  async function product(name: string, quantity: number) {
    const row = await prisma.product.create({ data: { storeId: store.id, name, slug: `${name}-${tag}`, price: 10, status: "ACTIVE", inventory: { create: { quantity } } }, include: { inventory: true } });
    return { id: row.id, inventoryId: row.inventory[0].id };
  }
  const p1 = await product("p1", 10);
  const p2 = await product("p2", 10);
  const stock = async (inventoryId: string) => (await prisma.inventory.findUniqueOrThrow({ where: { id: inventoryId } })).quantity;

  /** An order as checkout leaves it (stock already taken off). */
  async function makeOrder(options: { lines?: [typeof p1, number][]; createdAt?: Date; storeStatus?: "NEW" | "CONFIRMED"; payment?: { status: "PENDING" | "PAID"; providerReference: string | null } } = {}) {
    const lines = options.lines ?? [[p1, 2]];
    for (const [item, quantity] of lines) await prisma.inventory.update({ where: { id: item.inventoryId }, data: { quantity: { decrement: quantity } } });
    const total = lines.reduce((sum, [, quantity]) => sum + quantity * 10, 0);
    const created = await prisma.order.create({ data: {
      userId: customer.id, status: options.storeStatus === "CONFIRMED" ? "CONFIRMED" : "PENDING", subtotal: total, total, addressSnapshot: { line1: "x" }, createdAt: options.createdAt ?? old,
      storeOrders: { create: [{ storeId: store.id, status: options.storeStatus ?? "NEW", subtotal: total, createdAt: options.createdAt ?? old, items: { create: lines.map(([item, quantity]) => ({ productId: item.id, productName: "x", unitPrice: 10, quantity, lineTotal: quantity * 10 })) } }] },
      payments: { create: [{ amount: total, currency: "AZN", status: options.payment?.status ?? "PENDING", providerReference: options.payment?.providerReference ?? null }] },
    } });
    return created.id;
  }

  try {
    await t.test("an old unpaid order expires: stock back once, payment FAILED, audit, messages once; second run is a no-op", async () => {
      const before = await stock(p1.inventoryId);
      const orderId = await makeOrder();
      assert.equal(await stock(p1.inventoryId), before - 2);
      assert.equal((await expireUnpaidOrder(prisma, { orderId, now, minutes: 60 })).outcome, "EXPIRED");
      assert.equal((await expireUnpaidOrder(prisma, { orderId, now, minutes: 60 })).outcome, "CLOSED");
      assert.equal(await stock(p1.inventoryId), before);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true, storeOrders: true } });
      assert.equal(order.status, "CANCELLED");
      assert.equal(order.storeOrders[0].status, "CANCELLED");
      assert.equal(order.payments[0].status, "FAILED");
      const audits = await prisma.auditLog.findMany({ where: { entityId: orderId, action: ORDER_EXPIRED_AUDIT_ACTION } });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].actorId, null);
      const adjustments = await prisma.inventoryAdjustment.findMany({ where: { inventoryId: p1.inventoryId, delta: 2, actorUserId: customer.id } });
      assert.equal(adjustments.length, 1);
      assert.equal(await prisma.notification.count({ where: { userId: seller.id, title: "Sifariş ödənilmədiyi üçün ləğv edildi" } }), 1);
    });

    await t.test("two expiries at the same moment: exactly one effect", async () => {
      const before = await stock(p2.inventoryId);
      const orderId = await makeOrder({ lines: [[p2, 3]] });
      const results = await Promise.all([expireUnpaidOrder(prisma, { orderId, now, minutes: 60 }), expireUnpaidOrder(prisma, { orderId, now, minutes: 60 })]);
      assert.equal(results.filter((r) => r.outcome === "EXPIRED").length, 1, JSON.stringify(results));
      assert.ok(results.every((r) => ["EXPIRED", "LOCKED", "CLOSED"].includes(r.outcome)));
      assert.equal(await stock(p2.inventoryId), before);
      assert.equal(await prisma.auditLog.count({ where: { entityId: orderId, action: ORDER_EXPIRED_AUDIT_ACTION } }), 1);
    });

    await t.test("expiry vs the customer's own cancel at the same moment: one cancel, stock back once", async () => {
      const before = await stock(p1.inventoryId);
      const orderId = await makeOrder();
      const results = await Promise.allSettled([expireUnpaidOrder(prisma, { orderId, now, minutes: 60 }), cancelOrderByCustomer(prisma, { orderId, customerId: customer.id })]);
      const expired = results[0].status === "fulfilled" && results[0].value.outcome === "EXPIRED";
      const customerCancelled = results[1].status === "fulfilled";
      assert.equal(Number(expired) + Number(customerCancelled), 1, JSON.stringify(results.map((r) => r.status === "fulfilled" ? r.value : String((r.reason as Error).message))));
      assert.equal(await stock(p1.inventoryId), before);
    });

    await t.test("a held Order lock (payment start) makes the expiry skip at once; a claim is never expired", async () => {
      const orderId = await makeOrder();
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => { locked = resolve; });
      const holder = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
        locked();
        await held;
        // What a payment start does under the lock: claim the payment.
        await tx.payment.updateMany({ where: { orderId, status: "PENDING" }, data: { provider: "epoint", providerReference: `claim:${orderId}` } });
      }, { timeout: 30_000 });
      await lockTaken;
      const started = Date.now();
      assert.equal((await expireUnpaidOrder(prisma, { orderId, now, minutes: 60 })).outcome, "LOCKED");
      assert.ok(Date.now() - started < 5_000, "SKIP LOCKED: no waiting");
      release();
      await holder;
      assert.equal((await expireUnpaidOrder(prisma, { orderId, now, minutes: 60 })).outcome, "CLAIM_IN_PROGRESS");
      assert.equal((await prisma.storeOrder.findFirstOrThrow({ where: { orderId } })).status, "NEW");
    });

    await t.test("never expired: paid, confirmed, young, Epoint attempt in flight", async () => {
      const cases: [Parameters<typeof makeOrder>[0], string][] = [
        [{ payment: { status: "PAID", providerReference: "trx-paid" } }, "PAID"],
        [{ storeStatus: "CONFIRMED" }, "NOT_OPEN"],
        [{ createdAt: new Date(now.getTime() - 10 * 60_000) }, "TOO_YOUNG"],
        [{ payment: { status: "PENDING", providerReference: "trx-open" } }, "PAYMENT_IN_FLIGHT"],
      ];
      for (const [options, outcome] of cases) {
        const before = await stock(p1.inventoryId);
        const orderId = await makeOrder(options);
        assert.equal((await expireUnpaidOrder(prisma, { orderId, now, minutes: 60 })).outcome, outcome);
        assert.equal(await stock(p1.inventoryId), before - 2, `${outcome}: stock not restored`);
        assert.equal((await prisma.storeOrder.findFirstOrThrow({ where: { orderId } })).status, options?.storeStatus ?? "NEW");
      }
    });

    await t.test("the tick's real candidate query: switch off = nothing; on = expires eligible ones, Epoint asked first", async () => {
      const eligible = await makeOrder();
      const attempt = await makeOrder({ payment: { status: "PENDING", providerReference: "trx-ask" } });
      const off = await runOrderExpiryTick({ db: prisma as never, readSetting: async () => undefined, epointConfigured: () => true, checkRemotePayment: async () => "FAILED" });
      assert.deepEqual(off, { state: "off" });
      const asked: string[] = [];
      const result = await runOrderExpiryTick({
        db: prisma as never,
        readSetting: async (key) => (key === SETTING_KEYS.ordersUnpaidExpiryEnabled ? true : 60),
        epointConfigured: () => true,
        checkRemotePayment: async (paymentId) => { asked.push(paymentId); return "UNCHANGED"; },
        batch: 50,
      });
      assert.equal(result.state, "ran");
      if (result.state !== "ran") return;
      assert.ok(result.expired >= 1);
      // Only orders with a real Epoint reference are asked about (this one, and the in-flight case above).
      const askedRefs = await prisma.payment.findMany({ where: { id: { in: asked } }, select: { providerReference: true } });
      assert.ok(askedRefs.length >= 1 && askedRefs.every((row) => row.providerReference && !row.providerReference.startsWith("claim:")));
      assert.ok(result.inFlightIds.includes(attempt));
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: eligible } })).status, "CANCELLED");
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: attempt } })).status, "PENDING");
      // Paid, claimed and confirmed orders are not even candidates.
      const again = await runOrderExpiryTick({ db: prisma as never, readSetting: async (key) => (key === SETTING_KEYS.ordersUnpaidExpiryEnabled ? true : 60), epointConfigured: () => true, checkRemotePayment: async () => "UNCHANGED", batch: 50, excludeIds: result.inFlightIds });
      assert.equal(again.state === "ran" && again.candidates, 0);
    });

    await t.test("cancel lock-order fix: two cancels sharing two products in opposite line order never deadlock", async () => {
      for (let round = 0; round < 5; round++) {
        const a = await makeOrder({ lines: [[p1, 1], [p2, 1]], storeStatus: "NEW" });
        const b = await makeOrder({ lines: [[p2, 1], [p1, 1]], storeStatus: "NEW" });
        const before = [await stock(p1.inventoryId), await stock(p2.inventoryId)];
        const cancel = async (orderId: string) => prisma.$transaction(async (tx) => {
          const storeOrder = await tx.storeOrder.findFirstOrThrow({ where: { orderId } });
          await transitionVendorStoreOrder(tx, { id: storeOrder.id, storeId: store.id, actorUserId: seller.id, targetStatus: "CANCELLED" });
        }, { timeout: 20_000 });
        const results = await Promise.allSettled([cancel(a), cancel(b)]);
        assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled"], JSON.stringify(results.map((r) => r.status === "rejected" ? String((r.reason as { code?: string }).code ?? (r.reason as Error).message).slice(0, 80) : "ok")));
        assert.deepEqual([await stock(p1.inventoryId), await stock(p2.inventoryId)], [before[0] + 2, before[1] + 2]);
      }
    });
  } finally {
    await prisma.$disconnect();
  }
});
