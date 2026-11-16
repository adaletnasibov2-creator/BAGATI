/**
 * Customer order cancellation on real PostgreSQL: direct cancel, double cancel, cancel vs store dispatch, cancel vs
 * payment, request approve / reject / withdraw, the one-open-request index, and ownership.
 *
 * Safety: uses only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, database name containing "verify")
 * and REQUIRES BAGATI_VERIFY_SCHEMA = a cat_* scratch schema with all migrations including
 * 20261116020000_order_cancellation_requests. It creates its own rows (random tag) and deletes them at the end. Epoint
 * runs in sandbox mode with dummy keys and a fake transport: nothing leaves this machine. Skips (NOT VERIFIED) when the
 * cluster, schema or table is missing.
 *
 *   BAGATI_VERIFY_SCHEMA=cat_ordercancel npx tsx --test scripts/order-cancellation.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";

function guardedScratchUrl(): { url: string } | { refuse: string } | { skip: string } {
  const raw = process.env.BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL;
  if (!raw) return { skip: "verify database URL is not set" };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { refuse: "the verify URL is not a valid URL" }; }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return { refuse: "verify database host must be loopback" };
  if (parsed.port !== "5433") return { refuse: "verify database port must be exactly 5433" };
  if (!database.includes("verify")) return { refuse: "verify database name must contain \"verify\"" };
  const schema = process.env.BAGATI_VERIFY_SCHEMA;
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (needs a migrated cat_* scratch schema)" };
  if (!/^cat_[a-z0-9_]{1,40}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be a cat_* scratch schema" };
  parsed.searchParams.set("schema", schema);
  return { url: parsed.toString() };
}

test("customer order cancellation on PostgreSQL", { timeout: 180_000 }, async (t) => {
  const guard = guardedScratchUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  // The app modules use the global client from lib/prisma: point it at the scratch schema before importing them.
  process.env.DATABASE_URL = guard.url;
  Object.assign(process.env, {
    EPOINT_PAYMENTS_ENABLED: "1", EPOINT_ENVIRONMENT: "sandbox", EPOINT_PUBLIC_KEY: "it-public", EPOINT_PRIVATE_KEY: "it-dummy",
    EPOINT_CREATE_PAYMENT_URL: "http://127.0.0.1:9/create", EPOINT_STATUS_URL: "http://127.0.0.1:9/status", APP_BASE_URL: "http://127.0.0.1:3000",
  });
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = `it${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const [where] = await prisma.$queryRaw<{ db: string; port: number; schema: string }[]>`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`;
    assert.ok(where.db.includes("verify") && Number(where.port) === 5433 && where.schema.startsWith("cat_"));
    const migrated = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'OrderCancellationRequest'`;
    if (!migrated[0]?.n) return t.skip("NOT VERIFIED: scratch schema lacks the OrderCancellationRequest table (this test never migrates)");

    const service = await import("../lib/order-cancellation-service");
    const { transitionVendorStoreOrder, OrderFulfillmentError } = await import("../lib/order-fulfillment");
    const { setShipmentStatusAsAdmin, ShipmentAdminError } = await import("../lib/shipment-admin");
    const { startEpointCheckout, settleVerifiedEpointResult } = await import("../lib/payments/epoint-checkout");

    // Fixtures: one city, one admin, one customer, another customer, one seller with one store and two products.
    const city = await prisma.city.create({ data: { name: `Şəhər ${tag}`, slug: `${tag}-city`, isActive: true } });
    const mkUser = (suffix: string, role: "CUSTOMER" | "VENDOR" | "ADMIN") => prisma.user.create({ data: { id: `${tag}_${suffix}`, email: `${tag}-${suffix}@verify.invalid`, passwordHash: "x", role } });
    const [admin, customer, stranger, sellerUser] = await Promise.all([mkUser("admin", "ADMIN"), mkUser("customer", "CUSTOMER"), mkUser("stranger", "CUSTOMER"), mkUser("seller", "VENDOR")]);
    const vendor = await prisma.vendorProfile.create({ data: { userId: sellerUser.id, displayName: `Satıcı ${tag}`, sellerType: "INDIVIDUAL_ENTREPRENEUR", legalName: `Satıcı ${tag}`, voen: `9${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}1`, legalAddress: "Ünvan" } });
    const store = await prisma.store.create({ data: { vendorId: vendor.id, cityId: city.id, name: `Mağaza ${tag}`, slug: `${tag}-store`, status: "ACTIVE", isActive: true, legalInfoApproved: true, adminManaged: true } });
    const products = await Promise.all([1, 2].map((n) => prisma.product.create({ data: { storeId: store.id, name: `Məhsul ${n} ${tag}`, slug: `${tag}-p${n}`, price: new Prisma.Decimal(10), status: "ACTIVE", inventory: { create: { quantity: 20 } } }, include: { inventory: true } })));
    const stock = async (index: number) => (await prisma.inventory.findFirst({ where: { productId: products[index].id, variantId: null } }))!.quantity;

    /** An order as checkout leaves it: stock already deducted, store order NEW, payment PENDING. */
    async function makeOrder(options: { storeStatus?: "NEW" | "CONFIRMED" | "READY"; payment?: "PENDING" | "PAID"; quantity?: number; product?: number; userId?: string } = {}) {
      const quantity = options.quantity ?? 2;
      const product = products[options.product ?? 0];
      await prisma.inventory.updateMany({ where: { productId: product.id, variantId: null }, data: { quantity: { decrement: quantity } } });
      const order = await prisma.order.create({ data: {
        userId: options.userId ?? customer.id, status: "PENDING", subtotal: new Prisma.Decimal(10 * quantity), total: new Prisma.Decimal(10 * quantity), addressSnapshot: { recipientName: "Test", line1: "Küçə 1", city: city.name },
        payments: { create: { amount: new Prisma.Decimal(10 * quantity), currency: "AZN", status: options.payment ?? "PENDING" } },
        storeOrders: { create: { storeId: store.id, status: options.storeStatus ?? "NEW", subtotal: new Prisma.Decimal(10 * quantity), items: { create: { productId: product.id, productName: product.name, unitPrice: new Prisma.Decimal(10), quantity, lineTotal: new Prisma.Decimal(10 * quantity) } } } },
      }, include: { storeOrders: true, payments: true } });
      return { orderId: order.id, storeOrderId: order.storeOrders[0].id, paymentId: order.payments[0].id };
    }
    const codeOf = (error: unknown) => (error as { code?: string })?.code;

    await t.test("rule 1: direct cancel restores stock once, fails the pending payment, audits and notifies", async () => {
      const before = await stock(0);
      const { orderId, storeOrderId, paymentId } = await makeOrder();
      assert.equal(await stock(0), before - 2);
      const result = await service.cancelOrderByCustomer(prisma, { orderId, customerId: customer.id });
      assert.deepEqual(result.cancelledStoreOrderIds, [storeOrderId]);
      assert.equal(await stock(0), before, "stock restored");
      assert.equal((await prisma.storeOrder.findUnique({ where: { id: storeOrderId } }))!.status, "CANCELLED");
      assert.equal((await prisma.order.findUnique({ where: { id: orderId } }))!.status, "CANCELLED");
      assert.equal((await prisma.payment.findUnique({ where: { id: paymentId } }))!.status, "FAILED");
      assert.equal(await prisma.auditLog.count({ where: { action: "ORDER_CANCELLED_BY_CUSTOMER", entityId: orderId, actorId: customer.id } }), 1);
      assert.equal(await prisma.notification.count({ where: { userId: sellerUser.id, title: "Sifariş müştəri tərəfindən ləğv edildi" } }) >= 1, true);
      // A second cancel is refused and restores nothing.
      await assert.rejects(service.cancelOrderByCustomer(prisma, { orderId, customerId: customer.id }), (error) => codeOf(error) === "NOT_ALLOWED");
      assert.equal(await stock(0), before);
    });

    await t.test("double cancel: two concurrent requests, one wins, stock restored exactly once", async () => {
      const before = await stock(1);
      const { orderId } = await makeOrder({ product: 1, quantity: 3 });
      const results = await Promise.allSettled([1, 2, 3].map(() => service.cancelOrderByCustomer(prisma, { orderId, customerId: customer.id })));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.ok(results.filter((r) => r.status === "rejected").every((r) => codeOf((r as PromiseRejectedResult).reason) === "NOT_ALLOWED"));
      assert.equal(await stock(1), before);
      assert.equal(await prisma.inventoryAdjustment.count({ where: { inventory: { productId: products[1].id }, reason: { contains: "ləğv edildiyi üçün stok bərpa edildi" }, delta: 3 } }), 1);
    });

    await t.test("ownership: another customer cannot see, cancel or request", async () => {
      const { orderId, storeOrderId } = await makeOrder();
      await assert.rejects(service.cancelOrderByCustomer(prisma, { orderId, customerId: stranger.id }), (error) => codeOf(error) === "NOT_FOUND");
      await assert.rejects(service.requestStoreOrderCancellation(prisma, { orderId, storeOrderId, customerId: stranger.id, reason: "başqasının sifarişi" }), (error) => codeOf(error) === "NOT_FOUND");
      await service.cancelOrderByCustomer(prisma, { orderId, customerId: customer.id });
    });

    await t.test("rule 2 boundary: a confirmed order cannot be cancelled directly, even unpaid; a request is needed", async () => {
      const { orderId, storeOrderId } = await makeOrder({ storeStatus: "CONFIRMED" });
      await assert.rejects(service.cancelOrderByCustomer(prisma, { orderId, customerId: customer.id }), (error) => codeOf(error) === "NOT_ALLOWED");
      const request = await service.requestStoreOrderCancellation(prisma, { orderId, storeOrderId, customerId: customer.id, reason: "Fikrimi dəyişdim" });
      assert.equal(request.status, "REQUESTED");
      assert.equal(await prisma.auditLog.count({ where: { action: "ORDER_CANCELLATION_REQUESTED", entityId: storeOrderId, actorId: customer.id } }), 1);
      // One open request per store order: the service refuses, and the partial unique index refuses a direct insert.
      await assert.rejects(service.requestStoreOrderCancellation(prisma, { orderId, storeOrderId, customerId: customer.id, reason: "yenə" }), (error) => codeOf(error) === "REQUEST_OPEN");
      await assert.rejects(prisma.orderCancellationRequest.create({ data: { storeOrderId, customerId: customer.id, reason: "birbaşa" } }), (error) => codeOf(error) === "P2002");
      // Withdraw, then a new request is possible.
      await service.withdrawStoreOrderCancellation(prisma, { orderId, requestId: request.id, customerId: customer.id });
      await assert.rejects(service.withdrawStoreOrderCancellation(prisma, { orderId, requestId: request.id, customerId: customer.id }), (error) => codeOf(error) === "REQUEST_NOT_OPEN");
      const again = await service.requestStoreOrderCancellation(prisma, { orderId, storeOrderId, customerId: customer.id, reason: "Yenidən istəyirəm" });
      // Reject needs no stock change; the order continues.
      const before = await stock(0);
      await service.decideStoreOrderCancellation(prisma, { storeId: store.id, requestId: again.id, actorUserId: sellerUser.id, decision: "REJECT", response: "Artıq qablaşdırılıb" });
      assert.equal((await prisma.orderCancellationRequest.findUnique({ where: { id: again.id } }))!.status, "REJECTED");
      assert.equal((await prisma.storeOrder.findUnique({ where: { id: storeOrderId } }))!.status, "CONFIRMED");
      assert.equal(await stock(0), before);
    });

    await t.test("paid order: approve = store cancel, stock restored once, payment stays PAID (refund manual)", async () => {
      const before = await stock(0);
      const { orderId, storeOrderId, paymentId } = await makeOrder({ storeStatus: "NEW", payment: "PAID" });
      await assert.rejects(service.cancelOrderByCustomer(prisma, { orderId, customerId: customer.id }), (error) => codeOf(error) === "NOT_ALLOWED", "paid: no direct cancel");
      const request = await service.requestStoreOrderCancellation(prisma, { orderId, storeOrderId, customerId: customer.id, reason: "Səhv ölçü seçmişəm" });
      const decided = await service.decideStoreOrderCancellation(prisma, { storeId: store.id, requestId: request.id, actorUserId: sellerUser.id, decision: "APPROVE", response: null });
      assert.equal(decided.status, "APPROVED");
      assert.equal(decided.refundPendingManual, true);
      assert.equal(await stock(0), before, "restored once");
      assert.equal((await prisma.payment.findUnique({ where: { id: paymentId } }))!.status, "PAID", "refund state untouched");
      // Deciding again is refused.
      await assert.rejects(service.decideStoreOrderCancellation(prisma, { storeId: store.id, requestId: request.id, actorUserId: sellerUser.id, decision: "APPROVE" }), (error) => codeOf(error) === "REQUEST_NOT_OPEN");
      // The admin refunds list query finds it.
      const needed = await prisma.storeOrder.count({ where: { id: storeOrderId, status: "CANCELLED", order: { payments: { some: { status: "PAID" } } } } });
      assert.equal(needed, 1);
    });

    await t.test("cancel vs dispatch: no dispatch while a request is open, by status or shipment; race has one winner", async () => {
      const { orderId, storeOrderId } = await makeOrder({ storeStatus: "READY", payment: "PAID" });
      const request = await service.requestStoreOrderCancellation(prisma, { orderId, storeOrderId, customerId: customer.id, reason: "Gecikir" });
      await assert.rejects(prisma.$transaction((tx) => transitionVendorStoreOrder(tx, { id: storeOrderId, storeId: store.id, actorUserId: sellerUser.id, targetStatus: "HANDED_TO_COURIER" })), (error) => error instanceof OrderFulfillmentError && error.code === "CANCELLATION_REQUEST_OPEN");
      await assert.rejects(setShipmentStatusAsAdmin(prisma, { storeOrderId, actorId: admin.id, target: "OUT_FOR_DELIVERY" }), (error) => error instanceof ShipmentAdminError && error.code === "CANCELLATION_REQUEST_OPEN");
      assert.equal((await prisma.storeOrder.findUnique({ where: { id: storeOrderId } }))!.status, "READY");
      // A store cancel through the normal status change approves the open request.
      await prisma.$transaction((tx) => transitionVendorStoreOrder(tx, { id: storeOrderId, storeId: store.id, actorUserId: sellerUser.id, targetStatus: "CANCELLED" }));
      assert.equal((await prisma.orderCancellationRequest.findUnique({ where: { id: request.id } }))!.status, "APPROVED");

      // Race: a request and a dispatch at the same moment on a READY order. Exactly one may win.
      for (let round = 0; round < 5; round++) {
        const race = await makeOrder({ storeStatus: "READY", payment: "PAID" });
        const [requested, dispatched] = await Promise.allSettled([
          service.requestStoreOrderCancellation(prisma, { orderId: race.orderId, storeOrderId: race.storeOrderId, customerId: customer.id, reason: "Yarış testi" }),
          prisma.$transaction((tx) => transitionVendorStoreOrder(tx, { id: race.storeOrderId, storeId: store.id, actorUserId: sellerUser.id, targetStatus: "HANDED_TO_COURIER" })),
        ]);
        const status = (await prisma.storeOrder.findUnique({ where: { id: race.storeOrderId } }))!.status;
        const open = await prisma.orderCancellationRequest.count({ where: { storeOrderId: race.storeOrderId, status: "REQUESTED" } });
        assert.equal([requested, dispatched].filter((r) => r.status === "fulfilled").length, 1, `round ${round}: one winner`);
        assert.ok(!(status === "HANDED_TO_COURIER" && open > 0), `round ${round}: never dispatched with an open request`);
        if (requested.status === "rejected") assert.equal(codeOf(requested.reason), "NOT_ALLOWED");
      }
    });

    await t.test("cancel vs payment: payment start refuses a cancelled order; a late PAID is recorded for a manual refund", async () => {
      const { orderId, storeOrderId, paymentId } = await makeOrder();
      await service.cancelOrderByCustomer(prisma, { orderId, customerId: customer.id });
      let transportCalls = 0;
      const refused = await startEpointCheckout(customer.id, orderId, async () => { transportCalls++; throw new Error("must not be called"); });
      assert.deepEqual(refused, { ok: false, code: "ORDER_CANCELLED" });
      assert.equal(transportCalls, 0);
      // The customer had paid in another tab before cancelling: the provider confirms afterwards.
      const decision = await settleVerifiedEpointResult({ paymentId, transaction: `${tag}-tx`, amount: "20.00", currency: "AZN", providerStatus: "success" } as never);
      assert.equal(decision.type, "set");
      assert.equal((await prisma.payment.findUnique({ where: { id: paymentId } }))!.status, "PAID");
      assert.equal(await prisma.auditLog.count({ where: { action: "PAYMENT_PAID_AFTER_CANCELLATION", entityId: orderId } }), 1);
      assert.equal(await prisma.storeOrder.count({ where: { id: storeOrderId, status: "CANCELLED", order: { payments: { some: { status: "PAID" } } } } }), 1, "listed as refund needed");
    });
  } finally {
    // Remove everything this run created (cascades cover store orders, items, payments, requests, inventory).
    await prisma.notification.deleteMany({ where: { userId: { startsWith: tag } } }).catch(() => undefined);
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { startsWith: tag } }, { action: "PAYMENT_PAID_AFTER_CANCELLATION", entityId: { in: (await prisma.order.findMany({ where: { userId: { startsWith: tag } }, select: { id: true } }).catch(() => [])).map((o) => o.id) } }] } }).catch(() => undefined);
    await prisma.emailOutbox.deleteMany({ where: { recipient: { contains: tag } } }).catch(() => undefined);
    await prisma.inventoryAdjustment.deleteMany({ where: { inventory: { product: { slug: { startsWith: tag } } } } }).catch(() => undefined);
    await prisma.order.deleteMany({ where: { userId: { startsWith: tag } } }).catch(() => undefined);
    await prisma.product.deleteMany({ where: { slug: { startsWith: tag } } }).catch(() => undefined);
    await prisma.store.deleteMany({ where: { slug: { startsWith: tag } } }).catch(() => undefined);
    await prisma.vendorProfile.deleteMany({ where: { userId: { startsWith: tag } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { startsWith: tag } } }).catch(() => undefined);
    await prisma.city.deleteMany({ where: { slug: { startsWith: tag } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
