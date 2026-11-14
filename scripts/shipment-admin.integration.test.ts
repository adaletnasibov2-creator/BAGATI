/**
 * Admin shipment status against the isolated verification PostgreSQL cluster, in a SCRATCH schema only.
 *
 * Safety: uses only BAGATI_CATALOG_IMPORT_VERIFY_DATABASE_URL (loopback, port 5433, database name containing "verify")
 * and REQUIRES BAGATI_VERIFY_SCHEMA starting with "dl_" that is already migrated. Never applies migrations. Skips
 * (NOT VERIFIED) when the cluster or schema is missing. Creates its own rows and removes them in `finally`.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { setShipmentStatusAsAdmin, ShipmentAdminError } from "../lib/shipment-admin";

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
  if (!schema) return { skip: "BAGATI_VERIFY_SCHEMA is not set (needs a migrated dl_* scratch schema)" };
  if (!/^dl_[a-z0-9_]{1,40}$/.test(schema)) return { refuse: "BAGATI_VERIFY_SCHEMA must be a dl_* scratch schema" };
  parsed.searchParams.set("schema", schema);
  return { url: parsed.toString() };
}

test("admin shipment status: forward only, audited, closed orders refused, order/payment untouched", { timeout: 120_000 }, async (t) => {
  const guard = guardedScratchUrl();
  if ("skip" in guard) return t.skip(`NOT VERIFIED: ${guard.skip}`);
  if ("refuse" in guard) throw new Error(`Refusing to run: ${guard.refuse}.`);
  const prisma = new PrismaClient({ datasources: { db: { url: guard.url } } });
  const tag = randomUUID().slice(0, 8);
  const created: { users: string[]; cityId?: string; vendorId?: string; storeId?: string; orderIds: string[] } = { users: [], orderIds: [] };
  try {
    try { await prisma.$queryRaw`SELECT 1`; } catch { return t.skip("NOT VERIFIED: verify database on 127.0.0.1:5433 is unreachable"); }
    const [where] = await prisma.$queryRaw<{ db: string; port: number; schema: string }[]>`SELECT current_database() AS db, inet_server_port() AS port, current_schema() AS schema`;
    assert.ok(where.db.includes("verify") && Number(where.port) === 5433 && where.schema.startsWith("dl_"));
    const migrated = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`.catch(() => [{ n: 0 }]);
    if (!migrated[0]?.n) return t.skip("NOT VERIFIED: scratch schema is not migrated (this test never migrates)");

    const admin = await prisma.user.create({ data: { email: `admin-${tag}@dl.invalid`, passwordHash: "x", role: "ADMIN" } });
    const customer = await prisma.user.create({ data: { email: `customer-${tag}@dl.invalid`, passwordHash: "x", role: "CUSTOMER" } });
    const seller = await prisma.user.create({ data: { email: `seller-${tag}@dl.invalid`, passwordHash: "x", role: "VENDOR" } });
    created.users.push(admin.id, customer.id, seller.id);
    const city = await prisma.city.create({ data: { name: `Şəhər ${tag}`, slug: `city-${tag}` } }); created.cityId = city.id;
    const vendor = await prisma.vendorProfile.create({ data: { userId: seller.id, displayName: `Satıcı ${tag}` } }); created.vendorId = vendor.id;
    const store = await prisma.store.create({ data: { vendorId: vendor.id, cityId: city.id, name: `Mağaza ${tag}`, slug: `store-${tag}` } }); created.storeId = store.id;
    const makeOrder = async (status: "CONFIRMED" | "CANCELLED") => {
      const order = await prisma.order.create({ data: {
        userId: customer.id, status: "PENDING", subtotal: "10.00", total: "10.00", addressSnapshot: { line1: "Nizami 1", city: "Bakı", latitude: 40.4093, longitude: 49.8671 },
        storeOrders: { create: { storeId: store.id, status, subtotal: "10.00" } }, payments: { create: { amount: "10.00", currency: "AZN", status: "PENDING" } },
      }, include: { storeOrders: true } });
      created.orderIds.push(order.id);
      return order;
    };

    const open = await makeOrder("CONFIRMED");
    const storeOrderId = open.storeOrders[0].id;
    await setShipmentStatusAsAdmin(prisma, { storeOrderId, actorId: admin.id, target: "OUT_FOR_DELIVERY" });
    let row = await prisma.storeOrder.findUniqueOrThrow({ where: { id: storeOrderId } });
    assert.equal(row.shipmentStatus, "OUT_FOR_DELIVERY");
    assert.ok(row.shippedAt && row.outForDeliveryAt, "Yolda stamps shippedAt (skipped step) and outForDeliveryAt");

    await setShipmentStatusAsAdmin(prisma, { storeOrderId, actorId: admin.id, target: "DELIVERED" });
    row = await prisma.storeOrder.findUniqueOrThrow({ where: { id: storeOrderId } });
    assert.equal(row.shipmentStatus, "DELIVERED");
    assert.ok(row.deliveredAt);
    // Independence: the order status, the store order status and the payment are untouched.
    assert.equal(row.status, "CONFIRMED");
    const parent = await prisma.order.findUniqueOrThrow({ where: { id: open.id }, include: { payments: true } });
    assert.equal(parent.status, "PENDING");
    assert.deepEqual(parent.payments.map((payment) => [payment.status, payment.amount.toString()]), [["PENDING", "10"]]);
    assert.equal(parent.total.toString(), "10");

    const audits = await prisma.auditLog.findMany({ where: { entityType: "StoreOrder", entityId: storeOrderId }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(audits.map((audit) => [audit.action, audit.actorId, (audit.metadata as { from: string | null; to: string }).from, (audit.metadata as { to: string }).to]), [
      ["SHIPMENT_STATUS_UPDATE", admin.id, null, "OUT_FOR_DELIVERY"], ["SHIPMENT_STATUS_UPDATE", admin.id, "OUT_FOR_DELIVERY", "DELIVERED"],
    ]);
    assert.doesNotMatch(JSON.stringify(audits.map((audit) => audit.metadata)), /40\.40|49\.86|Nizami/, "no address or coordinates in the audit");

    await assert.rejects(setShipmentStatusAsAdmin(prisma, { storeOrderId, actorId: admin.id, target: "PREPARING" }), (error: unknown) => error instanceof ShipmentAdminError && error.code === "INVALID_TRANSITION");
    const cancelled = await makeOrder("CANCELLED");
    await assert.rejects(setShipmentStatusAsAdmin(prisma, { storeOrderId: cancelled.storeOrders[0].id, actorId: admin.id, target: "PREPARING" }), (error: unknown) => error instanceof ShipmentAdminError && error.code === "ORDER_CLOSED");
    await assert.rejects(setShipmentStatusAsAdmin(prisma, { storeOrderId: `missing-${tag}`, actorId: admin.id, target: "PREPARING" }), (error: unknown) => error instanceof ShipmentAdminError && error.code === "NOT_FOUND");
    assert.equal(await prisma.auditLog.count({ where: { entityType: "StoreOrder", entityId: storeOrderId } }), 2, "refused changes write no audit");
  } finally {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: created.users } } }).catch(() => undefined);
    await prisma.payment.deleteMany({ where: { orderId: { in: created.orderIds } } }).catch(() => undefined);
    await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } }).catch(() => undefined);
    if (created.storeId) await prisma.store.delete({ where: { id: created.storeId } }).catch(() => undefined);
    if (created.vendorId) await prisma.vendorProfile.delete({ where: { id: created.vendorId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: created.users } } }).catch(() => undefined);
    if (created.cityId) await prisma.city.delete({ where: { id: created.cityId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
